import type { AppDatabase } from '../../db/client'
import { withTransaction } from '../../db/transaction'
import { type AgentRecord, createAgentRepository } from '../../domain/agents/agent-repository'
import {
  type AgentRevisionRecord,
  createAgentRevisionRepository,
} from '../../domain/agents/agent-revision-repository'
import {
  type AgentSubagentLinkRecord,
  createAgentSubagentLinkRepository,
} from '../../domain/agents/agent-subagent-link-repository'
import type { DomainCommittedEventType } from '../../domain/events/committed-event-contract'
import { createFileLinkRepository } from '../../domain/files/file-link-repository'
import { createFileRepository } from '../../domain/files/file-repository'
import { createItemRepository } from '../../domain/runtime/item-repository'
import { createJobDependencyRepository } from '../../domain/runtime/job-dependency-repository'
import { createJobRepository } from '../../domain/runtime/job-repository'
import { createRunRepository, type RunRecord } from '../../domain/runtime/run-repository'
import { createSessionMessageRepository } from '../../domain/sessions/session-message-repository'
import type { ToolContext } from '../../domain/tooling/tool-registry'
import type { DomainError } from '../../shared/errors'
import {
  asFileId,
  asItemId,
  asJobDependencyId,
  asJobId,
  asRunId,
  type FileId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import { createEventStore } from '../commands/event-store'
import { appendJobCreatedEvents } from '../runtime/scheduling/job-events'
import { buildDelegatedChildJobQueueReason } from '../runtime/scheduling/job-status-reasons'
import { createWorkspaceService } from '../workspaces/workspace-service'
import { canReadAgent } from './agent-access'
import { resolveRuntimeSettingsFromAgentRevision } from './agent-runtime-policy'

export interface DelegationHandoffEnvelope {
  kind: 'delegation_handoff'
  parent: {
    agentId: string | null
    agentRevisionId: string
    runId: string
    sourceCallId: string
  }
  sessionId: string
  target: {
    agentId: string
    agentName: string
    agentRevisionId: string
    agentSlug: string
    alias: string
    delegationMode: AgentSubagentLinkRecord['delegationMode']
    inputFileIds: string[]
    runId: string
  }
  version: 1
}

export interface DelegationTaskEnvelope {
  instructions: string | null
  kind: 'delegation_task'
  task: string
  version: 1
}

export interface CreateChildRunInput {
  instructions?: string | null
  targetAlias: string
  task: string
  toolContext: ToolContext
}

export interface CreateChildRunResult {
  childAgent: AgentRecord
  childRevision: AgentRevisionRecord
  childRun: RunRecord
  handoff: DelegationHandoffEnvelope
  link: AgentSubagentLinkRecord
}

export interface DelegationService {
  createDelegatedChildRun: (input: CreateChildRunInput) => Result<CreateChildRunResult, DomainError>
}

export interface CreateDelegationServiceDependencies {
  db: AppDatabase
  fileStorageRoot: string
}

const formatDelegationHandoffText = (input: { childAgent: AgentRecord }): string =>
  [
    'Delegated run context.',
    `You are ${input.childAgent.name}.`,
    'Another agent delegated the next task to you.',
    'Complete it directly, or suspend the run if you need additional input.',
  ].join('\n')

const formatDelegatedTaskText = (task: string, instructions: string | null): string =>
  instructions && instructions.trim().length > 0
    ? [`Task: ${task}`, '', 'Instructions:', instructions.trim()].join('\n')
    : task

const toApiVersion = (value: unknown): string | number =>
  typeof value === 'string' || typeof value === 'number' ? value : 1

const createEventAppender = (
  eventStore: ReturnType<typeof createEventStore>,
  toolContext: ToolContext,
) => ({
  append: <TPayload extends Record<string, unknown>>(input: {
    aggregateId: string
    aggregateType: string
    payload: TPayload
    type: DomainCommittedEventType
  }) =>
    eventStore.append({
      actorAccountId: toolContext.tenantScope.accountId,
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      payload: input.payload,
      tenantId: toolContext.tenantScope.tenantId,
      type: input.type,
    }),
})

const collectParentVisibleFileIds = (
  dependencies: {
    fileRepository: ReturnType<typeof createFileRepository>
    sessionMessageRepository: ReturnType<typeof createSessionMessageRepository>
  },
  scope: ToolContext['tenantScope'],
  run: Pick<RunRecord, 'id' | 'threadId'>,
): Result<FileId[], DomainError> => {
  const fileIds = new Set<FileId>()

  const directRunFiles = dependencies.fileRepository.listByRunId(scope, run.id)

  if (!directRunFiles.ok) {
    return directRunFiles
  }

  for (const file of directRunFiles.value) {
    fileIds.add(file.id)
  }

  if (!run.threadId) {
    return ok([...fileIds])
  }

  const visibleMessages = dependencies.sessionMessageRepository.listByThreadId(scope, run.threadId)

  if (!visibleMessages.ok) {
    return visibleMessages
  }

  const visibleMessageFiles = dependencies.fileRepository.listByMessageIds(
    scope,
    visibleMessages.value.map((message) => message.id),
  )

  if (!visibleMessageFiles.ok) {
    return visibleMessageFiles
  }

  for (const linkedFile of visibleMessageFiles.value) {
    fileIds.add(asFileId(linkedFile.file.id))
  }

  return ok([...fileIds])
}

const linkInputFilesToChildRun = (
  dependencies: {
    appendEvent: ReturnType<typeof createEventAppender>
    fileLinkRepository: ReturnType<typeof createFileLinkRepository>
    fileRepository: ReturnType<typeof createFileRepository>
    now: string
    sessionMessageRepository: ReturnType<typeof createSessionMessageRepository>
  },
  input: {
    childRunId: RunRecord['id']
    toolContext: ToolContext
  },
): Result<FileId[], DomainError> => {
  const parentFileIds = collectParentVisibleFileIds(
    {
      fileRepository: dependencies.fileRepository,
      sessionMessageRepository: dependencies.sessionMessageRepository,
    },
    input.toolContext.tenantScope,
    input.toolContext.run,
  )

  if (!parentFileIds.ok) {
    return parentFileIds
  }

  const linkedFileIds: FileId[] = []

  for (const fileId of parentFileIds.value) {
    const exists = dependencies.fileLinkRepository.exists(input.toolContext.tenantScope, {
      fileId,
      linkType: 'run',
      targetId: input.childRunId,
    })

    if (!exists.ok) {
      return exists
    }

    if (exists.value) {
      linkedFileIds.push(fileId)
      continue
    }

    const linked = dependencies.fileLinkRepository.create(input.toolContext.tenantScope, {
      createdAt: dependencies.now,
      fileId,
      id: input.toolContext.createId('flk'),
      linkType: 'run',
      targetId: input.childRunId,
    })

    if (!linked.ok) {
      return linked
    }

    const linkedEvent = dependencies.appendEvent.append({
      aggregateId: fileId,
      aggregateType: 'file',
      payload: {
        fileId,
        linkType: 'run',
        runId: input.childRunId,
        targetId: input.childRunId,
      },
      type: 'file.linked',
    })

    if (!linkedEvent.ok) {
      return linkedEvent
    }

    linkedFileIds.push(fileId)
  }

  return ok(linkedFileIds)
}

export const createDelegationService = ({
  db,
  fileStorageRoot,
}: CreateDelegationServiceDependencies): DelegationService => ({
  createDelegatedChildRun: (input) => {
    const { run, tenantScope } = input.toolContext
    const sourceCallId = input.toolContext.toolCallId

    if (!run.agentRevisionId) {
      return err({
        message: `run ${run.id} is not bound to an agent revision`,
        type: 'conflict',
      })
    }

    const parentAgentRevisionId = run.agentRevisionId

    if (!sourceCallId) {
      return err({
        message: `run ${run.id} is missing a tool call binding for delegation`,
        type: 'conflict',
      })
    }

    return withTransaction(db, (tx) => {
      const revisionRepository = createAgentRevisionRepository(tx)
      const agentRepository = createAgentRepository(tx)
      const subagentLinkRepository = createAgentSubagentLinkRepository(tx)
      const runRepository = createRunRepository(tx)
      const fileRepository = createFileRepository(tx)
      const fileLinkRepository = createFileLinkRepository(tx)
      const itemRepository = createItemRepository(tx)
      const jobRepository = createJobRepository(tx)
      const jobDependencyRepository = createJobDependencyRepository(tx)
      const sessionMessageRepository = createSessionMessageRepository(tx)
      const eventStore = createEventStore(tx)
      const appendEvent = createEventAppender(eventStore, input.toolContext)

      const parentRevision = revisionRepository.getById(tenantScope, parentAgentRevisionId)

      if (!parentRevision.ok) {
        return parentRevision
      }

      const subagentLinks = subagentLinkRepository.listByParentRevisionId(
        tenantScope,
        parentRevision.value.id,
      )

      if (!subagentLinks.ok) {
        return subagentLinks
      }

      const link =
        subagentLinks.value.find((candidate) => candidate.alias === input.targetAlias) ?? null

      if (!link) {
        return err({
          message: `agent alias "${input.targetAlias}" is not allowed for revision ${parentRevision.value.id}`,
          type: 'validation',
        })
      }

      const childAgent = agentRepository.getById(tenantScope, link.childAgentId)

      if (!childAgent.ok) {
        return childAgent
      }

      if (!canReadAgent(tenantScope, childAgent.value)) {
        return err({
          message: `agent ${childAgent.value.id} is not visible to account ${tenantScope.accountId}`,
          type: 'permission',
        })
      }

      if (childAgent.value.status !== 'active') {
        return err({
          message: `agent ${childAgent.value.id} is not active`,
          type: 'conflict',
        })
      }

      if (!childAgent.value.activeRevisionId) {
        return err({
          message: `agent ${childAgent.value.id} has no active revision`,
          type: 'conflict',
        })
      }

      const childRevision = revisionRepository.getById(
        tenantScope,
        childAgent.value.activeRevisionId,
      )

      if (!childRevision.ok) {
        return childRevision
      }

      const runtimeSettings = resolveRuntimeSettingsFromAgentRevision(
        childRevision.value,
        run.toolProfileId,
      )
      const workspaceService = createWorkspaceService(tx, {
        createId: input.toolContext.createId,
        fileStorageRoot,
      })
      const now = input.toolContext.nowIso()
      const workspace = workspaceService.requireWritableWorkspaceResolution(tenantScope, {
        nowIso: now,
        ownerAccountId: tenantScope.accountId,
        workspaceId: run.workspaceId,
      })

      if (!workspace.ok) {
        return workspace
      }

      const childRunId = asRunId(input.toolContext.createId('run'))
      const childJobId = asJobId(input.toolContext.createId('job'))
      const childRunWorkspaceRef = workspaceService.ensureRunRef(
        workspace.value.workspace,
        childRunId,
      )
      const parentJob = run.jobId ? jobRepository.getById(tenantScope, run.jobId) : ok(null)

      if (!parentJob.ok) {
        return parentJob
      }

      const childJobParentId = parentJob.value?.id ?? null
      const childJobRootId = parentJob.value?.rootJobId ?? childJobId
      const childRun = runRepository.create(tenantScope, {
        agentId: childAgent.value.id,
        agentRevisionId: childRevision.value.id,
        configSnapshot: {
          ...(run.threadId ? { eventThreadId: run.threadId } : {}),
          model: runtimeSettings.resolvedConfigSnapshot.model,
          modelAlias: runtimeSettings.resolvedConfigSnapshot.modelAlias,
          provider: runtimeSettings.resolvedConfigSnapshot.provider,
          reasoning: runtimeSettings.resolvedConfigSnapshot.reasoning,
          version: toApiVersion(run.configSnapshot.version),
        },
        createdAt: now,
        id: childRunId,
        parentRunId: run.id,
        targetKind: 'agent',
        toolProfileId: runtimeSettings.toolProfileId,
        rootRunId: run.rootRunId,
        sessionId: run.sessionId,
        sourceCallId,
        startedAt: now,
        task: input.instructions?.trim() || input.task.trim(),
        threadId: null,
        jobId: childJobId,
        workspaceId: workspace.value.workspace.id,
        workspaceRef: childRunWorkspaceRef,
      })

      if (!childRun.ok) {
        return childRun
      }

      const childJob = jobRepository.create(tenantScope, {
        assignedAgentId: childAgent.value.id,
        assignedAgentRevisionId: childRevision.value.id,
        createdAt: now,
        currentRunId: childRun.value.id,
        id: childJobId,
        inputJson: {
          instructions: input.instructions?.trim() || null,
          parentRunId: run.id,
          parentJobId: childJobParentId,
          source: 'delegate_to_agent',
          sourceCallId,
          targetAlias: input.targetAlias,
          task: input.task.trim(),
        },
        kind: 'task',
        lastSchedulerSyncAt: now,
        parentJobId: childJobParentId,
        queuedAt: now,
        rootJobId: childJobRootId,
        sessionId: run.sessionId,
        statusReasonJson: buildDelegatedChildJobQueueReason({
          delegationMode: link.delegationMode,
          parentRunId: run.id,
          runId: childRun.value.id,
          sourceCallId,
          targetAlias: input.targetAlias,
        }),
        status: 'queued',
        threadId: run.threadId,
        title: input.task.trim(),
        updatedAt: now,
      })

      if (!childJob.ok) {
        return childJob
      }

      if (childJobParentId) {
        const dependencyEdge = jobDependencyRepository.create(tenantScope, {
          createdAt: now,
          fromJobId: childJobParentId,
          id: asJobDependencyId(input.toolContext.createId('jdp')),
          metadataJson: {
            childRunId: childRun.value.id,
            delegationMode: link.delegationMode,
            parentRunId: run.id,
            sourceCallId,
            targetAlias: input.targetAlias,
          },
          sessionId: run.sessionId,
          toJobId: childJob.value.id,
          type: 'depends_on',
        })

        if (!dependencyEdge.ok) {
          return dependencyEdge
        }
      }

      const childJobCreatedEvents = appendJobCreatedEvents({
        eventStore,
        scope: tenantScope,
        job: childJob.value,
      })

      if (!childJobCreatedEvents.ok) {
        return childJobCreatedEvents
      }

      const workspaceCreatedEvent = workspace.value.created
        ? appendEvent.append({
            aggregateId: workspace.value.workspace.id,
            aggregateType: 'workspace',
            payload: {
              accountId: workspace.value.workspace.accountId,
              kind: workspace.value.workspace.kind,
              parentRunId: run.id,
              reason: 'child.run',
              rootRef: workspace.value.workspace.rootRef,
              rootRunId: run.rootRunId,
              runId: childRun.value.id,
              sessionId: childRun.value.sessionId,
              status: workspace.value.workspace.status,
              workspaceId: workspace.value.workspace.id,
              workspaceRef: childRunWorkspaceRef,
            },
            type: 'workspace.created',
          })
        : ok(null)

      if (!workspaceCreatedEvent.ok) {
        return workspaceCreatedEvent
      }

      const workspaceResolvedEvent = appendEvent.append({
        aggregateId: workspace.value.workspace.id,
        aggregateType: 'workspace',
        payload: {
          accountId: workspace.value.workspace.accountId,
          kind: workspace.value.workspace.kind,
          parentRunId: run.id,
          reason: 'child.run',
          rootRef: workspace.value.workspace.rootRef,
          rootRunId: run.rootRunId,
          runId: childRun.value.id,
          sessionId: childRun.value.sessionId,
          status: workspace.value.workspace.status,
          workspaceId: workspace.value.workspace.id,
          workspaceRef: childRunWorkspaceRef,
        },
        type: 'workspace.resolved',
      })

      if (!workspaceResolvedEvent.ok) {
        return workspaceResolvedEvent
      }

      const linkedInputFiles = linkInputFilesToChildRun(
        {
          appendEvent,
          fileLinkRepository,
          fileRepository,
          now,
          sessionMessageRepository,
        },
        {
          childRunId: childRun.value.id,
          toolContext: input.toolContext,
        },
      )

      if (!linkedInputFiles.ok) {
        return linkedInputFiles
      }

      const handoff: DelegationHandoffEnvelope = {
        kind: 'delegation_handoff',
        parent: {
          agentId: run.agentId,
          agentRevisionId: parentAgentRevisionId,
          runId: run.id,
          sourceCallId,
        },
        sessionId: run.sessionId,
        target: {
          agentId: childAgent.value.id,
          agentName: childAgent.value.name,
          agentRevisionId: childRevision.value.id,
          agentSlug: childAgent.value.slug,
          alias: link.alias,
          delegationMode: link.delegationMode,
          runId: childRun.value.id,
          inputFileIds: linkedInputFiles.value,
        },
        version: 1,
      }
      const taskEnvelope: DelegationTaskEnvelope = {
        instructions: input.instructions?.trim() || null,
        kind: 'delegation_task',
        task: input.task.trim(),
        version: 1,
      }

      const handoffItem = itemRepository.createMessage(tenantScope, {
        content: [
          {
            text: formatDelegationHandoffText({ childAgent: childAgent.value }),
            type: 'text',
          },
        ],
        createdAt: now,
        id: asItemId(input.toolContext.createId('itm')),
        providerPayload: handoff,
        role: 'developer',
        runId: childRun.value.id,
        sequence: 1,
      })

      if (!handoffItem.ok) {
        return handoffItem
      }

      const taskItem = itemRepository.createMessage(tenantScope, {
        content: [
          {
            text: formatDelegatedTaskText(taskEnvelope.task, taskEnvelope.instructions),
            type: 'text',
          },
        ],
        createdAt: now,
        id: asItemId(input.toolContext.createId('itm')),
        providerPayload: taskEnvelope,
        role: 'user',
        runId: childRun.value.id,
        sequence: 2,
      })

      if (!taskItem.ok) {
        return taskItem
      }

      const runCreatedEvent = appendEvent.append({
        aggregateId: childRun.value.id,
        aggregateType: 'run',
        payload: {
          agentId: childAgent.value.id,
          agentAlias: link.alias,
          agentName: childAgent.value.name,
          agentRevisionId: childRevision.value.id,
          ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}),
          parentRunId: run.id,
          rootRunId: run.rootRunId,
          runId: childRun.value.id,
          sessionId: childRun.value.sessionId,
          sourceCallId,
          targetKind: 'agent',
          task: input.task.trim(),
          threadId: childRun.value.threadId,
        },
        type: 'run.created',
      })

      if (!runCreatedEvent.ok) {
        return runCreatedEvent
      }

      const childRunCreatedEvent = appendEvent.append({
        aggregateId: childRun.value.id,
        aggregateType: 'run',
        payload: {
          alias: link.alias,
          childAgentId: childAgent.value.id,
          childAgentName: childAgent.value.name,
          childAgentRevisionId: childRevision.value.id,
          parentRunId: run.id,
          rootRunId: run.rootRunId,
          runId: childRun.value.id,
          sessionId: childRun.value.sessionId,
          sourceCallId,
          threadId: childRun.value.threadId,
        },
        type: 'child_run.created',
      })

      if (!childRunCreatedEvent.ok) {
        return childRunCreatedEvent
      }

      const delegationStartedEvent = appendEvent.append({
        aggregateId: run.id,
        aggregateType: 'run',
        payload: {
          alias: link.alias,
          callId: sourceCallId,
          childAgentId: childAgent.value.id,
          childAgentName: childAgent.value.name,
          childAgentRevisionId: childRevision.value.id,
          childRunId: childRun.value.id,
          rootRunId: run.rootRunId,
          runId: run.id,
          sessionId: run.sessionId,
          sourceCallId,
          threadId: run.threadId,
        },
        type: 'delegation.started',
      })

      if (!delegationStartedEvent.ok) {
        return delegationStartedEvent
      }

      return ok({
        childAgent: childAgent.value,
        childRevision: childRevision.value,
        childRun: childRun.value,
        handoff,
        link,
      })
    })
  },
})
