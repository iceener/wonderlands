import { describe, expect, test } from 'vitest'
import type { BrowserAuthMembership } from '../services/auth'
import { createWorkspaceProvider } from './workspace-provider.svelte.ts'

const createMembership = (tenantId: string, tenantName: string): BrowserAuthMembership => ({
  role: 'member',
  tenantId,
  tenantName,
  tenantSlug: tenantName.toLowerCase(),
})

describe('createWorkspaceProvider', () => {
  test('filters memberships and delegates only non-current workspace selection', async () => {
    const calls: string[] = []
    const provider = createWorkspaceProvider({
      currentTenantId: () => 'ten_current',
      getMemberships: () => [
        createMembership('ten_current', 'Alpha'),
        createMembership('ten_other', 'Beta'),
      ],
      onSwitchTenant: async (tenantId) => {
        calls.push(tenantId)
      },
    })

    const all = provider.getItems('')
    expect(all.map(({ item }) => item.id)).toEqual(['workspace:ten_current', 'workspace:ten_other'])

    await all[0]?.item.run()
    const filtered = provider.getItems('beta')
    expect(filtered.map(({ item }) => item.id)).toEqual(['workspace:ten_other'])
    await filtered[0]?.item.run()

    expect(calls).toEqual(['ten_other'])
  })
})
