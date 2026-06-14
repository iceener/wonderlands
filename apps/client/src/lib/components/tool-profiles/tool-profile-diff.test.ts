import { describe, expect, test } from 'vitest'

import { planToolProfileAccessChanges } from './tool-profile-diff'

describe('planToolProfileAccessChanges', () => {
  test('does not schedule duplicate removals for a disabled tool already present in current grants', () => {
    const currentRows = [
      {
        enabled: true,
        runtimeName: 'spotify__health',
        serverId: 'mcs_spotify',
        trusted: false,
      },
    ]

    const desiredRows = [
      {
        enabled: false,
        runtimeName: 'spotify__health',
        serverId: 'mcs_spotify',
        trusted: false,
      },
    ]

    expect(planToolProfileAccessChanges(currentRows, desiredRows)).toEqual({
      assignments: [],
      removals: ['spotify__health'],
    })
  })

  test('upserts only changed enabled tools and removes enabled tools missing from desired rows', () => {
    const currentRows = [
      {
        enabled: true,
        runtimeName: 'spotify__health',
        serverId: 'mcs_spotify',
        trusted: false,
      },
      {
        enabled: true,
        runtimeName: 'spotify__player_status',
        serverId: 'mcs_spotify',
        trusted: true,
      },
    ]

    const desiredRows = [
      {
        enabled: true,
        runtimeName: 'spotify__health',
        serverId: 'mcs_spotify',
        trusted: true,
      },
    ]

    expect(planToolProfileAccessChanges(currentRows, desiredRows)).toEqual({
      assignments: [
        {
          requiresConfirmation: false,
          runtimeName: 'spotify__health',
          serverId: 'mcs_spotify',
        },
      ],
      removals: ['spotify__player_status'],
    })
  })
})
