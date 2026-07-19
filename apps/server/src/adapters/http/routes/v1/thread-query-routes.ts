import type { Hono } from 'hono'
import { z } from 'zod'

import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import {
  isNativeToolAllowedForRun,
  isToolAllowedForRun,
  resolveMcpModeForRun,
} from '../../../../application/agents/agent-runtime-policy'
import { collectContextFacts } from '../../../../application/context/collect-context-facts'
import { projectContextFactsToThreadContextData } from '../../../../application/context/context-facts'
import { readContextState } from '../../../../application/context/read-context-state'
import { readMessageAttachmentFileIds } from '../../../../application/files/attachment-metadata'
import { buildAttachmentRefDescriptors } from '../../../../application/files/attachment-ref-context'
import { resolveAttachmentRefsInText } from '../../../../application/files/ref-resolution'
import { assembleThreadInteractionRequest } from '../../../../application/interactions/assemble-thread-interaction-request'
import { applyLatestBudgetCalibration } from '../../../../application/interactions/context-bundle'
import { buildMcpCodeModeCatalog } from '../../../../application/mcp/code-mode'
import { toToolContext } from '../../../../application/runtime/execution/run-tool-execution'
import { rebuildRunExecutionOutput } from '../../../../application/runtime/projection/rebuild-run-execution-output'
import {
  compareThreadActivityReadModels,
  resolveThreadActivityReadModel,
  type ThreadActivityState,
} from '../../../../application/runtime/projection/thread-activity-read-model'
import { loadThreadRootJobReadModel } from '../../../../application/runtime/scheduling/job-read-model'
import { resolveContextWindowForModel } from '../../../../application/system/models-catalog'
import { DomainErrorException } from '../../../../shared/errors'
import { asRunId, asSessionThreadId } from '../../../../shared/ids'
import { createUsageLedgerRepository } from '../../../persistence/sqlite/ai/usage-ledger-repository'
import { createFileRepository } from '../../../persistence/sqlite/files/file-repository'
import { createRunRepository } from '../../../persistence/sqlite/runtime/run-repository'
import { createSessionMessageRepository } from '../../../persistence/sqlite/sessions/session-message-repository'
import { createSessionThreadRepository } from '../../../persistence/sqlite/sessions/session-thread-repository'
import { createThreadActivitySeenRepository } from '../../../persistence/sqlite/sessions/thread-activity-seen-repository'
import { successEnvelope } from '../../api-envelope'
import { requireThreadAccess } from '../../route-resource-access'
import { parseQueryAs, toCommandContext, unwrapRouteResult } from '../../route-support'
import {
  mergeUniqueMessageAttachments,
  sortMessageAttachments,
  toMessageAttachmentEntry,
} from './thread-query-route-support'

const isSeenActivityState = (
  state: ThreadActivityState,
): state is Extract<ThreadActivityState, 'completed' | 'failed'> =>
  state === 'completed' || state === 'failed'

const listThreadsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  query: z.string().trim().max(200).optional(),
})

const listThreadActivityQuerySchema = z.object({
  completed_within_minutes: z.coerce.number().int().min(0).max(10_080).optional(),
})

export const registerThreadQueryRoutes = (routes: Hono<AppEnv>): void => {
  routes.get('/', async (c) => {
    const parsed = parseQueryAs(c, listThreadsQuerySchema, {
      limit: c.req.query('limit'),
      query: c.req.query('query') ?? undefined,
    })

    const tenantScope = requireTenantScope(c)
    const threadRepository = createSessionThreadRepository(c.get('db'))
    const result = unwrapRouteResult(
      threadRepository.listVisibleByAccount(tenantScope, {
        limit: parsed.limit ?? 50,
        query: parsed.query,
      }),
    )

    const threadsWithGraph = result.map((thread) => {
      const rootJob = unwrapRouteResult(
        loadThreadRootJobReadModel(c.get('db'), tenantScope, thread.id),
      )

      return {
        ...thread,
        rootJob,
      }
    })

    return c.json(successEnvelope(c, { threads: threadsWithGraph }), 200)
  })

  routes.get('/activity', async (c) => {
    const parsed = parseQueryAs(c, listThreadActivityQuerySchema, {
      completed_within_minutes: c.req.query('completed_within_minutes') ?? undefined,
    })

    const tenantScope = requireTenantScope(c)
    const threadRepository = createSessionThreadRepository(c.get('db'))
    const result = unwrapRouteResult(threadRepository.listRootVisibleByAccount(tenantScope))

    const nowIso = c.get('services').clock.nowIso()
    const completedWithinMinutes = parsed.completed_within_minutes ?? 30
    const threadActivitySnapshots = result
      .map((thread) => {
        const rootJob = unwrapRouteResult(
          loadThreadRootJobReadModel(c.get('db'), tenantScope, thread.id),
        )

        if (!rootJob) {
          return null
        }

        const activity = unwrapRouteResult(
          resolveThreadActivityReadModel(c.get('db'), tenantScope, rootJob, {
            completedWithinMinutes,
            nowIso,
          }),
        )

        if (!activity) {
          return null
        }

        return {
          activity,
          currentRunId: rootJob.currentRunId,
          id: thread.id,
          title: thread.title,
        }
      })
      .filter((thread): thread is NonNullable<typeof thread> => thread !== null)

    const threadActivitySeenRepository = createThreadActivitySeenRepository(c.get('db'))
    const seenRows = unwrapRouteResult(
      threadActivitySeenRepository.listByThreadIds(
        tenantScope,
        threadActivitySnapshots.map((thread) => thread.id),
      ),
    )

    const seenByThreadId = new Map(seenRows.map((row) => [row.threadId, row]))
    const threadsWithActivity = threadActivitySnapshots
      .filter((thread) => {
        if (!isSeenActivityState(thread.activity.state) || !thread.currentRunId) {
          return true
        }

        return seenByThreadId.get(thread.id)?.seenCompletedRunId !== thread.currentRunId
      })
      .sort((left, right) => {
        const activityDelta = compareThreadActivityReadModels(left.activity, right.activity)

        if (activityDelta !== 0) {
          return activityDelta
        }

        return right.id.localeCompare(left.id)
      })
      .slice(0, 10)
      .map(({ activity, id, title }) => ({
        activity,
        id,
        title,
      }))

    return c.json(successEnvelope(c, { threads: threadsWithActivity }), 200)
  })

  routes.post('/:threadId/activity/seen', async (c) => {
    const threadId = asSessionThreadId(c.req.param('threadId'))
    const { session, thread, tenantScope } = requireThreadAccess(c, threadId)

    if (session.createdByAccountId !== tenantScope.accountId) {
      throw new DomainErrorException({
        message: `account ${tenantScope.accountId} cannot access thread ${threadId}`,
        type: 'permission',
      })
    }

    if (thread.parentThreadId) {
      return c.body(null, 204)
    }

    const rootJob = unwrapRouteResult(
      loadThreadRootJobReadModel(c.get('db'), tenantScope, threadId),
    )

    if (!rootJob?.currentRunId) {
      return c.body(null, 204)
    }

    const activity = unwrapRouteResult(
      resolveThreadActivityReadModel(c.get('db'), tenantScope, rootJob, {
        completedWithinMinutes: 10_080,
        nowIso: c.get('services').clock.nowIso(),
      }),
    )

    if (!activity || !isSeenActivityState(activity.state)) {
      return c.body(null, 204)
    }

    const threadActivitySeenRepository = createThreadActivitySeenRepository(c.get('db'))
    unwrapRouteResult(
      threadActivitySeenRepository.upsert(tenantScope, {
        seenCompletedAt: activity.completedAt ?? activity.updatedAt,
        seenCompletedRunId: rootJob.currentRunId,
        threadId,
        updatedAt: c.get('services').clock.nowIso(),
      }),
    )

    return c.body(null, 204)
  })

  routes.get('/:threadId', async (c) => {
    const { thread, tenantScope } = requireThreadAccess(
      c,
      asSessionThreadId(c.req.param('threadId')),
    )

    const rootJob = unwrapRouteResult(
      loadThreadRootJobReadModel(c.get('db'), tenantScope, thread.id),
    )

    return c.json(
      successEnvelope(c, {
        ...thread,
        rootJob,
      }),
      200,
    )
  })

  routes.get('/:threadId/messages', async (c) => {
    const { thread, tenantScope } = requireThreadAccess(
      c,
      asSessionThreadId(c.req.param('threadId')),
    )

    const db = c.get('db')
    const sessionMessageRepository = createSessionMessageRepository(db)
    const messages = unwrapRouteResult(
      sessionMessageRepository.listByThreadId(tenantScope, thread.id),
    )
    const userMessageIds = messages
      .filter((message) => message.authorKind === 'user')
      .map((message) => message.id)
    const assistantMessagesByRunId = new Map<string, typeof messages>()

    for (const message of messages) {
      if (message.authorKind !== 'assistant' || !message.runId) {
        continue
      }

      const current = assistantMessagesByRunId.get(message.runId) ?? []
      current.push(message)
      assistantMessagesByRunId.set(message.runId, current)
    }

    const fileRepository = createFileRepository(db)
    const linkedFiles = fileRepository.listByMessageIds(tenantScope, userMessageIds)
    const assistantRunFiles = fileRepository.listByRunIds(
      tenantScope,
      [...assistantMessagesByRunId.keys()].map(asRunId),
    )

    if (!linkedFiles.ok || !assistantRunFiles.ok) {
      return c.json(successEnvelope(c, messages), 200)
    }

    const apiBasePath = c.get('config').api.basePath
    const attachmentRefs = buildAttachmentRefDescriptors({
      apiBasePath,
      linkedFiles: linkedFiles.value,
      visibleMessages: messages,
    })
    const filesByMessageId = new Map<string, ReturnType<typeof toMessageAttachmentEntry>[]>()

    for (const linked of linkedFiles.value) {
      const entry = toMessageAttachmentEntry(apiBasePath, linked.file)
      const existing = filesByMessageId.get(linked.messageId)

      if (existing) {
        existing.push(entry)
      } else {
        filesByMessageId.set(linked.messageId, [entry])
      }
    }

    for (const linked of assistantRunFiles.value) {
      const recipients = assistantMessagesByRunId.get(linked.runId)

      if (!recipients || recipients.length === 0) {
        continue
      }

      const entry = toMessageAttachmentEntry(apiBasePath, linked.file)

      for (const recipient of recipients) {
        filesByMessageId.set(
          recipient.id,
          mergeUniqueMessageAttachments(filesByMessageId.get(recipient.id), entry),
        )
      }
    }

    const enrichedMessages = messages.map((message) => {
      const files = filesByMessageId.get(message.id)
      const nextFiles = files
        ? sortMessageAttachments(readMessageAttachmentFileIds(message.metadata), files)
        : null
      const nextContent =
        message.authorKind === 'assistant'
          ? message.content.map((part) =>
              part.type === 'text'
                ? {
                    ...part,
                    text: resolveAttachmentRefsInText(attachmentRefs, part.text, 'markdown'),
                  }
                : part,
            )
          : message.content

      if (!nextFiles && nextContent === message.content) {
        return message
      }

      return {
        ...message,
        content: nextContent,
        metadata: {
          ...(typeof message.metadata === 'object' && message.metadata !== null
            ? message.metadata
            : {}),
          ...(nextFiles ? { attachments: nextFiles } : {}),
        },
      }
    })

    return c.json(successEnvelope(c, enrichedMessages), 200)
  })

  routes.get('/:threadId/budget', async (c) => {
    const { thread, tenantScope } = requireThreadAccess(
      c,
      asSessionThreadId(c.req.param('threadId')),
    )

    const usageLedgerRepository = createUsageLedgerRepository(c.get('db'))
    const latestBudget = unwrapRouteResult(
      usageLedgerRepository.getLatestThreadInteractionBudget(tenantScope, thread.id),
    )

    const runRepository = createRunRepository(c.get('db'))
    const threadRuns = unwrapRouteResult(runRepository.listByThreadId(tenantScope, thread.id))

    const latestRootRun = threadRuns.filter((run) => run.parentRunId === null).at(-1) ?? null

    if (!latestRootRun) {
      return c.json(successEnvelope(c, { budget: null }), 200)
    }

    const commandContext = toCommandContext(c)
    const contextState = unwrapRouteResult(readContextState(commandContext, latestRootRun))
    const contextFacts = unwrapRouteResult(await collectContextFacts(commandContext, contextState))
    const threadContext = projectContextFactsToThreadContextData(contextFacts)

    const activeTools = c
      .get('services')
      .tools.list(toToolContext(commandContext, latestRootRun))
      .filter((tool) => isToolAllowedForRun(c.get('db'), tenantScope, latestRootRun, tool))
    const mcpMode = resolveMcpModeForRun(c.get('db'), tenantScope, latestRootRun)
    const mcpCatalog =
      mcpMode === 'code'
        ? buildMcpCodeModeCatalog(toToolContext(commandContext, latestRootRun), activeTools)
        : null
    const nativeTools = isNativeToolAllowedForRun(
      c.get('db'),
      tenantScope,
      latestRootRun,
      'web_search',
    )
      ? (['web_search'] as const)
      : []
    const assembled = assembleThreadInteractionRequest({
      activeTools,
      context: threadContext,
      mcpCatalog,
      mcpMode,
      nativeTools: [...nativeTools],
      overrides: {},
    })
    const calibratedBudget = applyLatestBudgetCalibration(
      assembled.bundle.budget,
      latestBudget
        ? {
            latestActualInputTokens: latestBudget.inputTokens,
            latestCachedTokens: latestBudget.cachedTokens,
            latestEstimatedInputTokens: latestBudget.estimatedInputTokens,
          }
        : null,
    )
    const rebuiltExecution = unwrapRouteResult(
      rebuildRunExecutionOutput(commandContext, latestRootRun),
    )

    const actualUsage = rebuiltExecution?.usage ?? null
    const actualInputTokens = actualUsage?.inputTokens ?? latestBudget?.inputTokens ?? null
    const actualOutputTokens = actualUsage?.outputTokens ?? latestBudget?.outputTokens ?? null

    return c.json(
      successEnvelope(c, {
        budget: {
          actualInputTokens,
          actualOutputTokens,
          actualTotalTokens:
            actualUsage?.totalTokens ??
            (actualInputTokens !== null && actualOutputTokens !== null
              ? actualInputTokens + actualOutputTokens
              : null),
          cachedInputTokens: actualUsage?.cachedTokens ?? latestBudget?.cachedTokens ?? null,
          contextWindow: resolveContextWindowForModel(
            assembled.request.model ?? latestBudget?.model ?? c.get('config').ai.defaults.model,
          ),
          estimatedInputTokens: calibratedBudget.rawEstimatedInputTokens,
          measuredAt: latestBudget?.createdAt ?? null,
          model: latestBudget?.model ?? assembled.request.model ?? null,
          provider: latestBudget?.provider ?? assembled.request.provider ?? null,
          reasoningTokens: actualUsage?.reasoningTokens ?? null,
          reservedOutputTokens: calibratedBudget.reservedOutputTokens,
          stablePrefixTokens: calibratedBudget.stablePrefixTokens,
          turn: latestRootRun.turnCount + 1,
          volatileSuffixTokens: calibratedBudget.volatileSuffixTokens,
        },
      }),
      200,
    )
  })
}
