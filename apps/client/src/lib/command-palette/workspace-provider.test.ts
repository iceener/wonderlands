import { describe, expect, test } from 'vitest'
import type { BrowserAuthMembership } from '../services/auth'
import { createWorkspaceProvider } from './workspace-provider.svelte.ts'

const createMembership = (
  tenantId: string,
  overrides: Partial<BrowserAuthMembership> = {},
): BrowserAuthMembership => ({
  role: 'member',
  tenantId,
  tenantName: `Workspace ${tenantId}`,
  tenantSlug: `workspace-${tenantId}`,
  ...overrides,
})

describe('createWorkspaceProvider', () => {
  test('marks the current workspace in the label', async () => {
    const provider = createWorkspaceProvider({
      currentTenantId: () => 'ten_1',
      getMemberships: () => [createMembership('ten_1')],
      onSwitchTenant: () => undefined,
    })

    const results = provider.getItems('')

    expect(results[0]?.item.label).toBe('Current: Workspace ten_1')
  })

  test('filters memberships by query', async () => {
    const provider = createWorkspaceProvider({
      currentTenantId: () => 'ten_1',
      getMemberships: () => [
        createMembership('ten_1', { tenantName: 'Alpha' }),
        createMembership('ten_2', { tenantName: 'Beta' }),
      ],
      onSwitchTenant: () => undefined,
    })

    const results = provider.getItems('beta')

    expect(results).toHaveLength(1)
    expect(results[0]?.item.id).toBe('workspace:ten_2')
  })

  test('delegates tenant switching for non-current workspaces', async () => {
    const calls: string[] = []

    const provider = createWorkspaceProvider({
      currentTenantId: () => 'ten_1',
      getMemberships: () => [createMembership('ten_1'), createMembership('ten_2')],
      onSwitchTenant: async (tenantId) => {
        calls.push(tenantId)
      },
    })

    const result = provider.getItems('ten_2')[0]
    await result?.item.run()

    expect(calls).toEqual(['ten_2'])
  })
})
