import type { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv } from '../../../../app/types'
import {
  createBranchThreadCommand,
  parseBranchThreadInput,
} from '../../../../application/commands/branch-thread'
import { createDeleteThreadCommand } from '../../../../application/commands/delete-thread'
import {
  createEditThreadMessageCommand,
  parseEditThreadMessageInput,
} from '../../../../application/commands/edit-thread-message'
import { createEventStore } from '../../../../application/commands/event-store'
import {
  createPostThreadMessageCommand,
  parsePostThreadMessageInput,
} from '../../../../application/commands/post-thread-message'
import {
  createStartThreadInteractionCommand,
  parseStartThreadInteractionInput,
  type StartThreadInteractionOutput,
} from '../../../../application/commands/start-thread-interaction'
import {
  appendThreadNamingRequestedEvent,
  appendThreadUpdatedEvent,
} from '../../../../application/naming/thread-title-events'
import { withTransaction } from '../../../../db/transaction'
import { createRunRepository } from '../../../../domain/runtime/run-repository'
import { DomainErrorException } from '../../../../shared/errors'
import {
  asFileId,
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asWorkSessionId,
} from '../../../../shared/ids'
import { createSessionThreadRepository } from '../../../persistence/sqlite/sessions/session-thread-repository'
import { successEnvelope } from '../../api-envelope'
import {
  buildRecordedProgressIdempotentRoute,
  buildSnapshotRecoveryIdempotentRoute,
} from '../../idempotency'
import {
  postThreadMessageOutputSchema,
  sessionThreadRecordSchema,
  startThreadInteractionOutputSchema,
} from '../../idempotency-response-schemas'
import { idempotencyScopes, legacyIdempotencyScopes } from '../../idempotency-scopes'
import { parseJsonBody } from '../../parse-json-body'
import { authorizeThreadWrite } from '../../route-resource-access'
import { parseJsonBodyAs, toCommandContext, unwrapRouteResult } from '../../route-support'

const renameThreadBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
})

const threadInteractionRecoverySnapshotSchema = z
  .object({
    attachedFileIds: z.array(z.string().trim().min(1).max(200)),
    inputMessageId: z.string().trim().min(1).max(200),
    kind: z.literal('thread_interaction_started'),
    runId: z.string().trim().min(1).max(200),
    sessionId: z.string().trim().min(1).max(200),
    status: z.literal('accepted').optional(),
    threadId: z.string().trim().min(1).max(200),
  })
  .transform((value) => ({
    ...value,
    status: 'accepted' as const,
  }))

const buildThreadInteractionRecoverySnapshot = (output: StartThreadInteractionOutput) => ({
  attachedFileIds: output.attachedFileIds,
  inputMessageId: output.messageId,
  kind: 'thread_interaction_started' as const,
  runId: output.runId,
  sessionId: output.sessionId,
  status: 'accepted' as const,
  threadId: output.threadId,
})

const toThreadInteractionAcceptedSuccess = (
  snapshot: z.infer<typeof threadInteractionRecoverySnapshotSchema>,
) =>
  ({
    // Starting an interaction only enqueues work; the run is not completed synchronously.
    data: {
      attachedFileIds: snapshot.attachedFileIds.map((fileId) => asFileId(fileId)),
      inputMessageId: asSessionMessageId(snapshot.inputMessageId),
      runId: asRunId(snapshot.runId),
      sessionId: asWorkSessionId(snapshot.sessionId),
      status: snapshot.status,
      threadId: asSessionThreadId(snapshot.threadId),
    },
    status: 202,
  }) as const

export const registerThreadMutationRoutes = (routes: Hono<AppEnv>): void => {
  const branchThreadCommand = createBranchThreadCommand()
  const deleteThreadCommand = createDeleteThreadCommand()
  const editThreadMessageCommand = createEditThreadMessageCommand()
  const postThreadMessageCommand = createPostThreadMessageCommand()
  const startThreadInteractionCommand = createStartThreadInteractionCommand()

  routes.patch('/:threadId', async (c) => {
    const parsedInput = await parseJsonBodyAs(c, renameThreadBodySchema)
    const threadId = asSessionThreadId(c.req.param('threadId'))
    const { thread, tenantScope } = authorizeThreadWrite(c, threadId)

    const commandContext = toCommandContext(c)
    const result = withTransaction(c.get('db'), (tx) => {
      const threadRepository = createSessionThreadRepository(tx)
      const eventStore = createEventStore(tx)
      const updatedThread = threadRepository.update(tenantScope, thread.id, {
        title: parsedInput.title,
        titleSource: 'manual',
        updatedAt: commandContext.services.clock.nowIso(),
      })

      if (!updatedThread.ok) {
        return updatedThread
      }

      appendThreadUpdatedEvent(commandContext, eventStore, {
        sessionId: updatedThread.value.sessionId,
        threadId: updatedThread.value.id,
        title: updatedThread.value.title,
        titleSource: updatedThread.value.titleSource,
        updatedAt: updatedThread.value.updatedAt,
      })

      return updatedThread
    })

    return c.json(successEnvelope(c, unwrapRouteResult(result)), 200)
  })

  routes.post('/:threadId/title/regenerate', async (c) => {
    const threadId = asSessionThreadId(c.req.param('threadId'))
    const { thread, tenantScope } = authorizeThreadWrite(c, threadId)

    const runRepository = createRunRepository(c.get('db'))
    const threadRuns = unwrapRouteResult(runRepository.listByThreadId(tenantScope, thread.id))

    const latestRootRun = threadRuns.filter((run) => run.parentRunId === null).at(-1) ?? null

    if (!latestRootRun) {
      throw new DomainErrorException({
        message: `thread ${thread.id} does not have a root run to derive a title from`,
        type: 'conflict',
      })
    }

    const commandContext = toCommandContext(c)
    const eventStore = createEventStore(c.get('db'))
    const requestedAt = commandContext.services.clock.nowIso()

    appendThreadNamingRequestedEvent(commandContext, eventStore, {
      requestId: commandContext.services.ids.create('tnr'),
      requestedAt,
      sessionId: thread.sessionId,
      sourceRunId: latestRootRun.id,
      threadId: thread.id,
      trigger: 'manual_regenerate',
    })

    return c.json(
      successEnvelope(c, {
        accepted: true,
        threadId: thread.id,
      }),
      202,
    )
  })

  routes.delete('/:threadId', async (c) => {
    const threadId = asSessionThreadId(c.req.param('threadId'))
    const result = await deleteThreadCommand.execute(toCommandContext(c), threadId)

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(
      successEnvelope(c, {
        deleted: true,
        threadId: result.value.threadId,
      }),
      200,
    )
  })

  routes.post('/:threadId/branches', async (c) => {
    const parsedInput = parseBranchThreadInput(await parseJsonBody(c))
    const threadId = asSessionThreadId(c.req.param('threadId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return buildRecordedProgressIdempotentRoute(c, {
      execute: () => branchThreadCommand.execute(toCommandContext(c), threadId, parsedInput.value),
      parseReplayData: (value) => sessionThreadRecordSchema.parse(value),
      requestBody: {
        sourceThreadId: threadId,
        ...parsedInput.value,
      },
      legacyScopes: legacyIdempotencyScopes.threadBranchCreate(
        c.get('config').api.basePath,
        threadId,
      ),
      scope: idempotencyScopes.threadBranchCreate(threadId),
      status: 201,
    })
  })

  routes.post('/:threadId/messages', async (c) => {
    const parsedInput = parsePostThreadMessageInput(await parseJsonBody(c))
    const threadId = asSessionThreadId(c.req.param('threadId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return buildRecordedProgressIdempotentRoute(c, {
      execute: () =>
        postThreadMessageCommand.execute(toCommandContext(c), threadId, parsedInput.value),
      parseReplayData: (value) => postThreadMessageOutputSchema.parse(value),
      requestBody: {
        threadId,
        ...parsedInput.value,
      },
      legacyScopes: legacyIdempotencyScopes.threadMessagePost(
        c.get('config').api.basePath,
        threadId,
      ),
      scope: idempotencyScopes.threadMessagePost(threadId),
      status: 201,
    })
  })

  routes.patch('/:threadId/messages/:messageId', async (c) => {
    const parsedInput = parseEditThreadMessageInput(await parseJsonBody(c))
    const threadId = asSessionThreadId(c.req.param('threadId'))
    const messageId = asSessionMessageId(c.req.param('messageId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    const result = await editThreadMessageCommand.execute(toCommandContext(c), {
      input: parsedInput.value,
      messageId,
      threadId,
    })

    return c.json(successEnvelope(c, unwrapRouteResult(result)), 200)
  })

  routes.post('/:threadId/interactions', async (c) => {
    const parsedInput = parseStartThreadInteractionInput(await parseJsonBody(c))
    const threadId = asSessionThreadId(c.req.param('threadId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return buildSnapshotRecoveryIdempotentRoute<
      z.infer<typeof startThreadInteractionOutputSchema>,
      z.infer<typeof threadInteractionRecoverySnapshotSchema>
    >(c, {
      execute: () => {
        const commandContext = toCommandContext(c)
        const startResult = startThreadInteractionCommand.execute(
          commandContext,
          threadId,
          parsedInput.value,
        )

        if (!startResult.ok) {
          throw new DomainErrorException(startResult.error)
        }

        return buildThreadInteractionRecoverySnapshot(startResult.value)
      },
      parseReplayData: (value) => startThreadInteractionOutputSchema.parse(value),
      toSuccess: toThreadInteractionAcceptedSuccess,
      tryParseSnapshot: (value: unknown) => {
        const snapshot = threadInteractionRecoverySnapshotSchema.safeParse(value)

        if (!snapshot.success) {
          return null
        }

        return snapshot.data
      },
      requestBody: {
        threadId,
        ...parsedInput.value,
      },
      legacyScopes: legacyIdempotencyScopes.threadInteractionStart(
        c.get('config').api.basePath,
        threadId,
      ),
      scope: idempotencyScopes.threadInteractionStart(threadId),
    })
  })
}
