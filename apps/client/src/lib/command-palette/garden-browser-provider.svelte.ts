import type { BackendGardenSite } from '@wonderlands/contracts/chat'
import { searchCommands } from './search'
import type { CommandItem, PaletteProvider, ScoredCommandItem } from './types'

export interface GardenBrowserProviderDeps {
  listGardens: () => Promise<BackendGardenSite[]>
  onCreateNew: () => void
  onEditSite: (site: BackendGardenSite) => void
  onOpenArchive: () => void
}

export const isGardenVisibleInCommandPalette = (site: BackendGardenSite): boolean =>
  site.status !== 'archived'

const statusToGroup = (site: BackendGardenSite): string => {
  switch (site.status) {
    case 'active':
      return 'Active Gardens'
    case 'disabled':
      return 'Disabled Gardens'
    case 'archived':
      return 'Archived Gardens'
    default:
      return 'Draft Gardens'
  }
}

const toStatusHint = (site: BackendGardenSite): string => {
  if (site.currentPublishedBuildId) {
    return 'live'
  }

  return site.status
}

const toStaticResults = (items: readonly CommandItem[]): ScoredCommandItem[] =>
  items
    .filter((item) => item.enabled())
    .map((item, index) => ({
      item,
      matchRanges: [],
      score: 100 - index,
    }))

export const createGardenBrowserProvider = ({
  listGardens,
  onCreateNew,
  onEditSite,
  onOpenArchive,
}: GardenBrowserProviderDeps): PaletteProvider => {
  let cachedSites = $state<BackendGardenSite[] | null>(null)
  let isLoading = $state(false)
  let loadError = $state<string | null>(null)
  let inflight = $state<Promise<void> | null>(null)

  const resetCache = (): void => {
    cachedSites = null
    isLoading = false
    loadError = null
    inflight = null
  }

  const loadSites = async (force = false): Promise<void> => {
    if (inflight) {
      await inflight
      return
    }

    if (!force && cachedSites) {
      return
    }

    isLoading = true
    loadError = null

    const request = listGardens()
      .then((sites) => {
        cachedSites = sites
        loadError = null
      })
      .catch((error) => {
        cachedSites = null
        loadError = error instanceof Error ? error.message : 'Failed to load gardens.'
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
        id: 'gardens.new',
        label: 'New Garden Site',
        group: 'Actions',
        keywords: ['new', 'create', 'garden', 'publish', 'site'],
        enabled: () => true,
        run: () => onCreateNew(),
      },
      {
        id: 'gardens.archive',
        label: 'Garden Archive',
        group: 'Actions',
        keywords: ['archive', 'restore', 'archived', 'garden', 'site'],
        enabled: () => true,
        run: () => onOpenArchive(),
      },
    ]

    for (const site of (cachedSites ?? []).filter(isGardenVisibleInCommandPalette)) {
      items.push({
        id: site.id,
        label: site.name,
        group: statusToGroup(site),
        keywords: [
          site.slug,
          site.status,
          site.id,
          site.createdByAccountId,
          site.sourceScopePath,
          site.currentPublishedBuildId ? 'published' : 'unpublished',
        ],
        shortcutHint: toStatusHint(site),
        enabled: () => true,
        run: () => onEditSite(site),
      })
    }

    return items
  }

  return {
    id: 'garden-browser',
    mode: 'command',
    getItems(query) {
      if (!cachedSites && !isLoading && !inflight) {
        void loadSites()
      }

      if (loadError) {
        return toStaticResults([
          {
            id: 'gardens.retry',
            label: `Failed to load gardens — click to retry`,
            group: 'Gardens',
            keywords: ['retry', 'reload', 'gardens'],
            enabled: () => true,
            run: () => {
              void loadSites(true)
            },
          },
        ])
      }

      if (isLoading && !cachedSites) {
        return toStaticResults([
          {
            id: 'gardens.loading',
            label: 'Loading gardens…',
            group: 'Gardens',
            keywords: ['loading', 'gardens'],
            enabled: () => true,
            run: () => undefined,
          },
        ])
      }

      return searchCommands(query, getBaseItems())
    },
    onOpen() {
      void loadSites(true)
    },
    onSelect(item) {
      void item.run()
    },
    onDismiss() {
      resetCache()
    },
  }
}
