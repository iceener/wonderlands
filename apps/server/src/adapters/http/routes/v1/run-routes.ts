import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../../../app/types'
import {
  createCancelRunCommand,
  parseCancelRunInput,
} from '../../../../application/commands/cancel-run'
import {
  createExecuteRunCommand,
  parseExecuteRunInput,
} from '../../../../application/commands/execute-run'
import {
  createResumeRunCommand,
  parseResumeRunInput,
} from '../../../../application/commands/resume-run'
import {
  recoverCancelRunOutput,
  recoverExecuteRunOutput,
  recoverResumeRunOutput,
} from '../../../../application/runtime/persistence/run-command-recovery'
import { loadRunJobReadModel } from '../../../../application/runtime/scheduling/job-read-model'
import { DomainErrorException } from '../../../../shared/errors'
import {
  asRunId,
  asSandboxExecutionId,
  asSandboxWritebackOperationId,
} from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { buildRecoverableCommandIdempotentRoute } from '../../idempotency'
import {
  cancelRunOutputSchema,
  resumeRunOutputSchema,
  runExecutionOutputSchema,
} from '../../idempotency-response-schemas'
import { idempotencyScopes, legacyIdempotencyScopes } from '../../idempotency-scopes'
import { parseJsonBody } from '../../parse-json-body'
import { requireRunAccess, requireSandboxExecutionAccess } from '../../route-resource-access'
import { parseJsonBodyAs, toCommandContext, unwrapRouteResult } from '../../route-support'

const sandboxWritebackReviewBodySchema = z.object({
  operations: z
    .array(
      z.object({
        decision: z.enum(['approve', 'reject']),
        id: z.string().trim().min(1).max(200),
      }),
    )
    .min(1)
    .max(100),
})

const sandboxWritebackCommitBodySchema = z.object({
  operations: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
})

export const createRunRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()
  const cancelRunCommand = createCancelRunCommand()
  const executeRunCommand = createExecuteRunCommand()
  const resumeRunCommand = createResumeRunCommand()
  const toCancelHttpStatus = (status: 'cancelled' | 'cancelling'): 200 | 202 =>
    status === 'cancelling' ? 202 : 200
  const toResumeHttpStatus = (status: 'accepted' | 'completed' | 'waiting'): 200 | 202 =>
    status === 'completed' ? 200 : 202

  routes.get('/:runId', async (c) => {
    const { run, tenantScope } = requireRunAccess(c, asRunId(c.req.param('runId')))

    const job = unwrapRouteResult(loadRunJobReadModel(c.get('db'), tenantScope, run))

    return c.json(
      successEnvelope(c, {
        ...run,
        job,
      }),
      200,
    )
  })

  routes.post('/:runId/execute', async (c) => {
    const parsedInput = parseExecuteRunInput(await parseJsonBody(c))
    const runId = asRunId(c.req.param('runId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return buildRecoverableCommandIdempotentRoute(c, {
      execute: async () => {
        const commandContext = toCommandContext(c)
        return executeRunCommand.execute(commandContext, runId, parsedInput.value)
      },
      parseReplayData: (value) => runExecutionOutputSchema.parse(value),
      recoverConflict: async () => {
        const recovered = await recoverExecuteRunOutput({
          command: executeRunCommand,
          context: toCommandContext(c),
          executeInput: parsedInput.value,
          runId,
        })

        if (!recovered.ok) {
          throw new DomainErrorException(recovered.error)
        }

        return recovered.value
          ? {
              data: recovered.value,
              status: recovered.value.status === 'waiting' ? 202 : 200,
            }
          : null
      },
      requestBody: {
        runId,
        ...parsedInput.value,
      },
      legacyScopes: legacyIdempotencyScopes.runExecute(c.get('config').api.basePath, runId),
      scope: idempotencyScopes.runExecute(runId),
      toSuccess: (value) => ({
        data: value,
        status: value.status === 'waiting' ? 202 : 200,
      }),
    })
  })

  routes.post('/:runId/resume', async (c) => {
    const parsedInput = parseResumeRunInput(await parseJsonBody(c))
    const runId = asRunId(c.req.param('runId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return buildRecoverableCommandIdempotentRoute(c, {
      execute: async () => {
        const commandContext = toCommandContext(c)
        return resumeRunCommand.execute(commandContext, runId, parsedInput.value)
      },
      parseReplayData: (value) => resumeRunOutputSchema.parse(value),
      recoverConflict: async () => {
        const recovered = await recoverResumeRunOutput({
          command: resumeRunCommand,
          context: toCommandContext(c),
          resumeInput: parsedInput.value,
          runId,
        })

        if (!recovered.ok) {
          throw new DomainErrorException(recovered.error)
        }

        return recovered.value
          ? {
              data: recovered.value,
              status: toResumeHttpStatus(recovered.value.status),
            }
          : null
      },
      requestBody: {
        runId,
        ...parsedInput.value,
      },
      legacyScopes: legacyIdempotencyScopes.runResume(c.get('config').api.basePath, runId),
      scope: idempotencyScopes.runResume(runId),
      toSuccess: (value) => ({
        data: value,
        status: toResumeHttpStatus(value.status),
      }),
    })
  })

  routes.post('/:runId/cancel', async (c) => {
    const parsedInput = parseCancelRunInput(await parseJsonBody(c))
    const runId = asRunId(c.req.param('runId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return buildRecoverableCommandIdempotentRoute(c, {
      execute: async () => {
        const commandContext = toCommandContext(c)
        return cancelRunCommand.execute(commandContext, runId, parsedInput.value)
      },
      parseReplayData: (value) => cancelRunOutputSchema.parse(value),
      recoverConflict: async () => {
        const recovered = await recoverCancelRunOutput({
          cancelInput: parsedInput.value,
          command: cancelRunCommand,
          context: toCommandContext(c),
          runId,
        })

        if (!recovered.ok) {
          throw new DomainErrorException(recovered.error)
        }

        return recovered.value
          ? {
              data: recovered.value,
              status: toCancelHttpStatus(recovered.value.status),
            }
          : null
      },
      legacyScopes: legacyIdempotencyScopes.runCancel(c.get('config').api.basePath, runId),
      requestBody: {
        runId,
        ...parsedInput.value,
      },
      scope: idempotencyScopes.runCancel(runId),
      toSuccess: (value) => ({
        data: value,
        status: toCancelHttpStatus(value.status),
      }),
    })
  })

  routes.get('/:runId/sandbox/:sandboxExecutionId', async (c) => {
    const runId = asRunId(c.req.param('runId'))
    const sandboxExecutionId = asSandboxExecutionId(c.req.param('sandboxExecutionId'))
    const { tenantScope } = requireSandboxExecutionAccess(c, {
      runId,
      sandboxExecutionId,
    })

    const summary = c
      .get('services')
      .sandbox.read.getExecutionSummary(tenantScope, sandboxExecutionId)

    if (!summary.ok) {
      throw new DomainErrorException(summary.error)
    }

    return c.json(successEnvelope(c, summary.value), 200)
  })

  routes.post('/:runId/sandbox/:sandboxExecutionId/writebacks/review', async (c) => {
    const runId = asRunId(c.req.param('runId'))
    const sandboxExecutionId = asSandboxExecutionId(c.req.param('sandboxExecutionId'))
    const { tenantScope } = requireSandboxExecutionAccess(c, {
      runId,
      sandboxExecutionId,
    })

    const body = await parseJsonBodyAs(c, sandboxWritebackReviewBodySchema)
    const reviewed = c.get('services').sandbox.review.reviewWritebacks(tenantScope, {
      decisions: body.operations.map((operation) => ({
        decision: operation.decision,
        id: asSandboxWritebackOperationId(operation.id),
      })),
      reviewedAt: c.get('services').clock.nowIso(),
      sandboxExecutionId,
    })

    if (!reviewed.ok) {
      throw new DomainErrorException(reviewed.error)
    }

    return c.json(successEnvelope(c, reviewed.value), 200)
  })

  routes.post('/:runId/sandbox/:sandboxExecutionId/writebacks/commit', async (c) => {
    const runId = asRunId(c.req.param('runId'))
    const sandboxExecutionId = asSandboxExecutionId(c.req.param('sandboxExecutionId'))
    const { tenantScope } = requireSandboxExecutionAccess(c, {
      runId,
      sandboxExecutionId,
    })

    const body = await parseJsonBodyAs(c, sandboxWritebackCommitBodySchema)
    const committed = await c
      .get('services')
      .sandbox.writeback.commitApprovedWritebacks(tenantScope, {
        committedAt: c.get('services').clock.nowIso(),
        operationIds: body.operations?.map(asSandboxWritebackOperationId),
        sandboxExecutionId,
      })

    if (!committed.ok) {
      throw new DomainErrorException(committed.error)
    }

    return c.json(successEnvelope(c, committed.value), 200)
  })

  return routes
}
