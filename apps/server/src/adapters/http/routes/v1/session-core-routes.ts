import type { Hono } from 'hono'

import type { AppEnv } from '../../../../app/types'
import {
  createCreateSessionCommand,
  parseCreateSessionInput,
} from '../../../../application/commands/create-session'
import {
  createCreateSessionThreadCommand,
  parseCreateSessionThreadInput,
} from '../../../../application/commands/create-session-thread'
import { createFileRepository } from '../../../../domain/files/file-repository'
import { DomainErrorException } from '../../../../shared/errors'
import { asWorkSessionId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { buildRecordedProgressIdempotentRoute } from '../../idempotency'
import {
  sessionThreadRecordSchema,
  workSessionRecordSchema,
} from '../../idempotency-response-schemas'
import { idempotencyScopes, legacyIdempotencyScopes } from '../../idempotency-scopes'
import { parseJsonBody } from '../../parse-json-body'
import { toFileSummary } from '../../presenters/file-presenter'
import { requireSessionAccess } from '../../route-resource-access'
import { toCommandContext, unwrapRouteResult } from '../../route-support'

export const registerSessionCoreRoutes = (routes: Hono<AppEnv>): void => {
  const createSessionCommand = createCreateSessionCommand()
  const createSessionThreadCommand = createCreateSessionThreadCommand()

  routes.post('/', async (c) => {
    const parsedInput = parseCreateSessionInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return buildRecordedProgressIdempotentRoute(c, {
      execute: () => createSessionCommand.execute(toCommandContext(c), parsedInput.value),
      parseReplayData: (value) => workSessionRecordSchema.parse(value),
      legacyScopes: legacyIdempotencyScopes.sessionCreate(c.get('config').api.basePath),
      requestBody: parsedInput.value,
      scope: idempotencyScopes.sessionCreate(),
      status: 201,
    })
  })

  routes.post('/:sessionId/threads', async (c) => {
    const parsedInput = parseCreateSessionThreadInput(await parseJsonBody(c))
    const sessionId = asWorkSessionId(c.req.param('sessionId'))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return buildRecordedProgressIdempotentRoute(c, {
      execute: () =>
        createSessionThreadCommand.execute(toCommandContext(c), sessionId, parsedInput.value),
      parseReplayData: (value) => sessionThreadRecordSchema.parse(value),
      legacyScopes: legacyIdempotencyScopes.sessionThreadCreate(
        c.get('config').api.basePath,
        sessionId,
      ),
      requestBody: {
        sessionId,
        ...parsedInput.value,
      },
      scope: idempotencyScopes.sessionThreadCreate(sessionId),
      status: 201,
    })
  })

  routes.get('/:sessionId/files', async (c) => {
    const sessionId = asWorkSessionId(c.req.param('sessionId'))
    const { tenantScope } = requireSessionAccess(c, sessionId)

    const result = unwrapRouteResult(
      createFileRepository(c.get('db')).listBySessionId(tenantScope, sessionId),
    )

    return c.json(
      successEnvelope(
        c,
        result.map((file) => toFileSummary(c.get('config').api.basePath, file)),
      ),
      200,
    )
  })
}
