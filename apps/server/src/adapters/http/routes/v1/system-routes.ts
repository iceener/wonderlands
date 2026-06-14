import { Hono } from 'hono'

import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { buildModelsCatalog } from '../../../../application/system/models-catalog'
import {
  listObservabilityQuarantine,
  replayObservabilityQuarantineEntry,
} from '../../../../application/system/observability-quarantine'
import {
  replayObservabilityRun,
  replayObservabilitySession,
} from '../../../../application/system/observability-replay'
import { buildObservabilityStatus } from '../../../../application/system/observability-status'
import { buildRuntimeStatus } from '../../../../application/system/runtime-status'
import { successEnvelope } from '../../api-envelope'
import { unwrapRouteResult } from '../../route-support'

export const createSystemRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/health', (c) => {
    return c.json(
      successEnvelope(c, {
        status: 'ok',
      }),
    )
  })

  routes.get('/ready', (c) => {
    return c.json(
      successEnvelope(c, {
        status: 'ready',
      }),
    )
  })

  routes.get('/models', (c) => {
    const runtimeConfig = c.get('config')

    return c.json(successEnvelope(c, buildModelsCatalog(runtimeConfig, c.get('services').ai)))
  })

  routes.get('/runtime', (c) => {
    return c.json(
      successEnvelope(
        c,
        buildRuntimeStatus({
          kernel: c.get('services').kernel,
          sandbox: c.get('services').sandbox.executions,
        }),
      ),
    )
  })

  routes.get('/observability', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          buildObservabilityStatus({
            config: c.get('config'),
            db: c.get('db'),
            generatedAt: c.get('services').clock.nowIso(),
            tenantScope: requireTenantScope(c),
          }),
        ),
      ),
    )
  })

  routes.get('/observability/quarantine', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          listObservabilityQuarantine({
            db: c.get('db'),
            tenantScope: requireTenantScope(c),
          }),
        ),
      ),
    )
  })

  routes.post('/observability/replay/run/:runId', (c) => {
    const replayed = unwrapRouteResult(
      replayObservabilityRun({
        db: c.get('db'),
        replayedAt: c.get('services').clock.nowIso(),
        runId: c.req.param('runId'),
        tenantScope: requireTenantScope(c),
      }),
    )

    c.get('services').observability.worker.wake()

    return c.json(successEnvelope(c, replayed))
  })

  routes.post('/observability/replay/session/:sessionId', (c) => {
    const replayed = unwrapRouteResult(
      replayObservabilitySession({
        db: c.get('db'),
        replayedAt: c.get('services').clock.nowIso(),
        sessionId: c.req.param('sessionId'),
        tenantScope: requireTenantScope(c),
      }),
    )

    c.get('services').observability.worker.wake()

    return c.json(successEnvelope(c, replayed))
  })

  routes.post('/observability/quarantine/:outboxId/replay', (c) => {
    const replayed = unwrapRouteResult(
      replayObservabilityQuarantineEntry({
        db: c.get('db'),
        outboxId: c.req.param('outboxId'),
        replayedAt: c.get('services').clock.nowIso(),
        tenantScope: requireTenantScope(c),
      }),
    )

    c.get('services').observability.worker.wake()

    return c.json(successEnvelope(c, replayed))
  })

  return routes
}
