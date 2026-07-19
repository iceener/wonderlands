import assert from 'node:assert/strict'
import { test } from 'vitest'

import type { AppConfig } from '../../src/app/config'
import { resolveContextRollout } from '../../src/application/context/context-rollout'
import { asAccountId } from '../../src/shared/ids'

const buildConfig = (overrides: Partial<AppConfig['context']> = {}): AppConfig['context'] => ({
  assemblyMode: 'v2_shadow',
  manifestPersist: true,
  v2AccountAllowlist: [],
  ...overrides,
})

test('legacy mode never persists manifests even when persistence is enabled', () => {
  const decision = resolveContextRollout(
    buildConfig({ assemblyMode: 'legacy' }),
    asAccountId('acc_allowed'),
  )

  assert.deepEqual(decision, {
    mode: 'legacy',
    persistManifest: false,
  })
})

test('shadow mode requires the manifest persistence flag', () => {
  const decision = resolveContextRollout(
    buildConfig({ manifestPersist: false }),
    asAccountId('acc_allowed'),
  )

  assert.equal(decision.mode, 'v2_shadow')
  assert.equal(decision.persistManifest, false)
})

test('an empty shadow allowlist permits persistence for identified and null actors', () => {
  assert.equal(resolveContextRollout(buildConfig(), asAccountId('acc_any')).persistManifest, true)
  assert.equal(resolveContextRollout(buildConfig(), null).persistManifest, true)
})

test('a nonempty shadow allowlist permits only matching actor account IDs', () => {
  const config = buildConfig({ v2AccountAllowlist: ['acc_allowed'] })

  assert.equal(resolveContextRollout(config, asAccountId('acc_allowed')).persistManifest, true)
  assert.equal(resolveContextRollout(config, asAccountId('acc_other')).persistManifest, false)
})

test('a null actor is denied when the shadow allowlist is nonempty', () => {
  const decision = resolveContextRollout(buildConfig({ v2AccountAllowlist: ['acc_allowed'] }), null)

  assert.equal(decision.persistManifest, false)
})
