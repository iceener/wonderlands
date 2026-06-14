import type { BackendToolProfile } from '@wonderlands/contracts/chat'
import { searchCommands } from './search'
import type { CommandItem, PaletteProvider, ScoredCommandItem } from './types'

export interface ToolProfileBrowserProviderDeps {
  listToolProfiles: () => Promise<BackendToolProfile[]>
  onCreateNew: () => void
  onEditProfile: (profile: BackendToolProfile) => void
}

const scopeToGroup = (profile: BackendToolProfile): string => {
  switch (profile.scope) {
    case 'tenant_shared':
      return 'Shared Tool Profiles'
    case 'system':
      return 'System Tool Profiles'
    default:
      return 'My Tool Profiles'
  }
}

const toStaticResults = (items: readonly CommandItem[]): ScoredCommandItem[] =>
  items
    .filter((item) => item.enabled())
    .map((item, index) => ({
      item,
      matchRanges: [],
      score: 100 - index,
    }))

export const createToolProfileBrowserProvider = ({
  listToolProfiles,
  onCreateNew,
  onEditProfile,
}: ToolProfileBrowserProviderDeps): PaletteProvider => {
  let cachedProfiles = $state<BackendToolProfile[] | null>(null)
  let isLoading = $state(false)
  let loadError = $state<string | null>(null)
  let inflight = $state<Promise<void> | null>(null)

  const resetCache = (): void => {
    cachedProfiles = null
    isLoading = false
    loadError = null
    inflight = null
  }

  const loadProfiles = async (force = false): Promise<void> => {
    if (inflight) {
      await inflight
      return
    }

    if (!force && cachedProfiles) {
      return
    }

    isLoading = true
    loadError = null

    const request = listToolProfiles()
      .then((profiles) => {
        cachedProfiles = profiles
        loadError = null
      })
      .catch((error) => {
        cachedProfiles = null
        loadError = error instanceof Error ? error.message : 'Failed to load tool profiles.'
      })
      .finally(() => {
        isLoading = false
        inflight = null
      })

    inflight = request
    await request
  }

  const getBaseItems = (): CommandItem[] => {
    const items: CommandItem[] = [
      {
        id: 'tool-profiles.new',
        label: 'New Tool Profile',
        group: 'Actions',
        keywords: ['new', 'create', 'tool profile', 'tool access'],
        enabled: () => true,
        run: () => onCreateNew(),
      },
    ]

    for (const profile of cachedProfiles ?? []) {
      items.push({
        id: profile.id,
        label: profile.name,
        group: scopeToGroup(profile),
        keywords: [profile.scope.replaceAll('_', ' '), profile.status, profile.id],
        shortcutHint: profile.status === 'archived' ? 'archived' : undefined,
        enabled: () => true,
        run: () => onEditProfile(profile),
      })
    }

    return items
  }

  return {
    id: 'tool-profile-browser',
    mode: 'command',
    getItems(query) {
      if (!cachedProfiles && !isLoading && !inflight) {
        void loadProfiles()
      }

      if (loadError) {
        return toStaticResults([
          {
            id: 'tool-profiles.retry',
            label: `Failed to load tool profiles — click to retry`,
            group: 'Tool Profiles',
            keywords: ['retry', 'reload', 'tool profiles'],
            enabled: () => true,
            run: () => {
              void loadProfiles(true)
            },
          },
        ])
      }

      if (isLoading && !cachedProfiles) {
        return toStaticResults([
          {
            id: 'tool-profiles.loading',
            label: 'Loading tool profiles…',
            group: 'Tool Profiles',
            keywords: ['loading', 'tool profiles'],
            enabled: () => true,
            run: () => undefined,
          },
        ])
      }

      return searchCommands(query, getBaseItems())
    },
    onOpen() {
      void loadProfiles(true)
    },
    onSelect(item) {
      void item.run()
    },
    onDismiss() {
      resetCache()
    },
  }
}
