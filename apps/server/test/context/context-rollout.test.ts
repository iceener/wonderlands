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

test('context rollout applies the complete persistence truth table', () => {
  const scenarios = [
    {
      accountId: asAccountId('acc_allowed'),
      config: buildConfig({ assemblyMode: 'legacy' }),
      expected: { mode: 'legacy', persistManifest: false },
    },
    {
      accountId: asAccountId('acc_allowed'),
      config: buildConfig({ manifestPersist: false }),
      expected: { mode: 'v2_shadow', persistManifest: false },
    },
    {
      accountId: asAccountId('acc_any'),
      config: buildConfig(),
      expected: { mode: 'v2_shadow', persistManifest: true },
    },
    {
      accountId: null,
      config: buildConfig(),
      expected: { mode: 'v2_shadow', persistManifest: true },
    },
    {
      accountId: asAccountId('acc_allowed'),
      config: buildConfig({ v2AccountAllowlist: ['acc_allowed'] }),
      expected: { mode: 'v2_shadow', persistManifest: true },
    },
    {
      accountId: asAccountId('acc_other'),
      config: buildConfig({ v2AccountAllowlist: ['acc_allowed'] }),
      expected: { mode: 'v2_shadow', persistManifest: false },
    },
    {
      accountId: null,
      config: buildConfig({ v2AccountAllowlist: ['acc_allowed'] }),
      expected: { mode: 'v2_shadow', persistManifest: false },
    },
  ]

  for (const { accountId, config, expected } of scenarios) {
    assert.deepEqual(resolveContextRollout(config, accountId), expected)
  }
})
