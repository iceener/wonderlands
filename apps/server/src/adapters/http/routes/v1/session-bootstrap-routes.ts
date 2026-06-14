import type { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv } from '../../../../app/types'
import {
  type BootstrapSessionInput,
  type BootstrapSessionOutput,
  createBootstrapSessionCommand,
  parseBootstrapSessionInput,
} from '../../../../application/commands/bootstrap-session'
import { createExecuteRunCommand } from '../../../../application/commands/execute-run'
import { recoverExecuteRunOutput } from '../../../../application/runtime/persistence/run-command-recovery'
import type { RunExecutionOutput } from '../../../../application/runtime/persistence/run-persistence'
import type { HttpIdempotencyKeyRecord } from '../../../../domain/operations/http-idempotency-key-repository'
import { DomainErrorException } from '../../../../shared/errors'
import {
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asWorkSessionId,
} from '../../../../shared/ids'
import {
  maybeHandleIdempotentJsonRoute,
  recoverRecordedIdempotentProgress,
} from '../../idempotency'
import {
  bootstrapSessionOutputSchema,
  bootstrapSessionRouteOutputSchema,
} from '../../idempotency-response-schemas'
import { idempotencyScopes, legacyIdempotencyScopes } from '../../idempotency-scopes'
import { parseJsonBody } from '../../parse-json-body'
import { toCommandContext } from '../../route-support'

const bootstrapSessionRecoverySnapshotSchema = z.object({
  inputMessageId: z.string().trim().min(1).max(200),
  kind: z.literal('bootstrap_session_started'),
  runId: z.string().trim().min(1).max(200),
  sessionId: z.string().trim().min(1).max(200),
  threadId: z.string().trim().min(1).max(200),
})

const buildBootstrapSessionRecoverySnapshot = (output: BootstrapSessionOutput) => ({
  inputMessageId: output.messageId,
  kind: 'bootstrap_session_started' as const,
  runId: output.runId,
  sessionId: output.sessionId,
  threadId: output.threadId,
})

const toBootstrapSessionSuccess = (
  snapshot: z.infer<typeof bootstrapSessionRecoverySnapshotSchema>,
  output: RunExecutionOutput,
) =>
  ({
    data: {
      ...output,
      inputMessageId: asSessionMessageId(snapshot.inputMessageId),
      sessionId: asWorkSessionId(snapshot.sessionId),
      threadId: asSessionThreadId(snapshot.threadId),
    },
    status: output.status === 'waiting' ? 202 : 201,
  }) as const

const toBootstrapExecuteOverrides = (input: BootstrapSessionInput) => ({
  maxOutputTokens: input.maxOutputTokens,
  model: input.model,
  modelAlias: input.modelAlias,
  provider: input.provider,
  reasoning: input.reasoning,
  temperature: input.temperature,
})

export const registerSessionBootstrapRoutes = (routes: Hono<AppEnv>): void => {
  const bootstrapSessionCommand = createBootstrapSessionCommand()
  const executeRunCommand = createExecuteRunCommand()

  // The current frontend does not use this route. Keep it as a convenience
  // endpoint for callers that want to start the first turn in a single request.
  routes.post('/bootstrap', async (c) => {
    const parsedInput = parseBootstrapSessionInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return maybeHandleIdempotentJsonRoute<z.infer<typeof bootstrapSessionRouteOutputSchema>>(c, {
      execute: async (idempotency) => {
        const commandContext = toCommandContext(c)
        const result = bootstrapSessionCommand.execute(commandContext, parsedInput.value)

        if (!result.ok) {
          throw new DomainErrorException(result.error)
        }

        if (parsedInput.value.execute !== true) {
          idempotency?.recordProgress(result.value)

          return {
            data: result.value,
            status: 201,
          }
        }

        const snapshot = buildBootstrapSessionRecoverySnapshot(result.value)
        const executeOverrides = toBootstrapExecuteOverrides(parsedInput.value)

        idempotency?.recordProgress(snapshot)

        const executeResult = await executeRunCommand.execute(
          commandContext,
          asRunId(result.value.runId),
          executeOverrides,
        )

        if (!executeResult.ok) {
          if (executeResult.error.type === 'conflict') {
            const recovered = await recoverExecuteRunOutput({
              command: executeRunCommand,
              context: commandContext,
              executeInput: executeOverrides,
              runId: asRunId(snapshot.runId),
            })

            if (!recovered.ok) {
              throw new DomainErrorException(recovered.error)
            }

            if (recovered.value) {
              return toBootstrapSessionSuccess(snapshot, recovered.value)
            }
          }

          throw new DomainErrorException(executeResult.error)
        }

        return toBootstrapSessionSuccess(snapshot, executeResult.value)
      },
      parseReplayData: (value) => bootstrapSessionRouteOutputSchema.parse(value),
      recoverInProgress: async ({ record }: { record: HttpIdempotencyKeyRecord }) => {
        if (parsedInput.value.execute !== true) {
          return recoverRecordedIdempotentProgress({
            parse: (value) => bootstrapSessionOutputSchema.parse(value),
            record,
            status: 201,
          })
        }

        const snapshot = bootstrapSessionRecoverySnapshotSchema.safeParse(record.responseDataJson)

        if (!snapshot.success) {
          return null
        }

        const recovered = await recoverExecuteRunOutput({
          command: executeRunCommand,
          context: toCommandContext(c),
          executeInput: toBootstrapExecuteOverrides(parsedInput.value),
          runId: asRunId(snapshot.data.runId),
        })

        if (!recovered.ok) {
          throw new DomainErrorException(recovered.error)
        }

        if (!recovered.value) {
          return null
        }

        return toBootstrapSessionSuccess(snapshot.data, recovered.value)
      },
      legacyScopes: legacyIdempotencyScopes.sessionBootstrap(c.get('config').api.basePath),
      requestBody: parsedInput.value,
      scope: idempotencyScopes.sessionBootstrap(),
    })
  })
}
