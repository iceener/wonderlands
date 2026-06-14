import type { BrowserAuthMembership } from '../services/auth'
import { searchCommands } from './search'
import type { CommandItem, PaletteProvider } from './types'

export interface WorkspaceProviderDeps {
  currentTenantId: () => string | null
  getMemberships: () => readonly BrowserAuthMembership[]
  onSwitchTenant: (tenantId: string, membership: BrowserAuthMembership) => void | Promise<void>
}

const getWorkspaceLabel = (membership: BrowserAuthMembership): string =>
  membership.tenantName || membership.tenantSlug || membership.tenantId

const toWorkspaceLabel = (
  membership: BrowserAuthMembership,
  currentTenantId: string | null,
): string =>
  membership.tenantId === currentTenantId
    ? `Current: ${getWorkspaceLabel(membership)}`
    : getWorkspaceLabel(membership)

export const createWorkspaceProvider = ({
  currentTenantId,
  getMemberships,
  onSwitchTenant,
}: WorkspaceProviderDeps): PaletteProvider => ({
  id: 'workspaces',
  mode: 'workspace',
  getItems(query) {
    const activeTenantId = currentTenantId()
    const items: CommandItem[] = getMemberships().map((membership) => ({
      id: `workspace:${membership.tenantId}`,
      label: toWorkspaceLabel(membership, activeTenantId),
      group: 'Workspaces',
      keywords: [
        getWorkspaceLabel(membership),
        membership.tenantId,
        membership.tenantSlug,
        membership.role,
        'workspace',
        'tenant',
      ],
      shortcutHint: membership.role,
      enabled: () => true,
      run: async () => {
        if (membership.tenantId === currentTenantId()) {
          return
        }

        await onSwitchTenant(membership.tenantId, membership)
      },
    }))

    return searchCommands(query, items)
  },
  onSelect(item) {
    void item.run()
  },
  onDismiss() {
    // No persistent cache to clear, but satisfy the provider contract
  },
})
