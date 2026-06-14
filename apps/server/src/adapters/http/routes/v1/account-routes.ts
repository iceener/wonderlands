import { Hono } from 'hono'

import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import {
  createAccountPreferencesService,
  parseAccountPreferencesPatchInput,
  parseAccountPreferencesShortcutResetInput,
} from '../../../../application/preferences/account-preferences-service'
import { DomainErrorException } from '../../../../shared/errors'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBody } from '../../parse-json-body'
import { unwrapRouteResult } from '../../route-support'

const toAccountPreferencesService = (c: Parameters<typeof requireTenantScope>[0]) =>
  createAccountPreferencesService({
    db: c.get('db'),
    now: () => c.get('services').clock.nowIso(),
  })

export const createAccountRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/preferences', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(toAccountPreferencesService(c).getPreferences(requireTenantScope(c))),
      ),
      200,
    )
  })

  routes.patch('/preferences', async (c) => {
    const parsedInput = parseAccountPreferencesPatchInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toAccountPreferencesService(c).updatePreferences(
            requireTenantScope(c),
            parsedInput.value,
          ),
        ),
      ),
      200,
    )
  })

  routes.post('/preferences/shortcuts/reset', async (c) => {
    const parsedInput = parseAccountPreferencesShortcutResetInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toAccountPreferencesService(c).resetShortcutBindings(
            requireTenantScope(c),
            parsedInput.value,
          ),
        ),
      ),
      200,
    )
  })

  return routes
}
