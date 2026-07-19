import type { McpIndexedEntry, WorkspaceIndexedEntry } from './types'
import { workspaceIndexManager } from './workspace-index'

export interface McpFileRoot {
  mountId: string
  rootPath: string
}

// Index each filesystem-MCP mount root with the same walk/ignore/scoring used
// for the workspace vault, then mount-qualify the paths (e.g. `docs/notes/a.md`)
// so a picked entry inserts a reference the agent can read with its fs_* tools.
export const buildMcpEntries = async (
  roots: readonly McpFileRoot[],
): Promise<McpIndexedEntry[]> => {
  const entries: McpIndexedEntry[] = []

  for (const root of roots) {
    let indexed: WorkspaceIndexedEntry[]

    try {
      indexed = await workspaceIndexManager.get(root.rootPath)
    } catch {
      continue
    }

    for (const entry of indexed) {
      const qualifiedPath = `${root.mountId}/${entry.relativePath}`

      entries.push({
        depth: entry.depth + 1,
        extension: entry.extension,
        fileName: entry.fileName,
        mtimeMs: entry.mtimeMs,
        nameLower: entry.nameLower,
        pathLower: qualifiedPath.toLowerCase(),
        relativePath: qualifiedPath,
        source: 'mcp',
      })
    }
  }

  return entries
}

export const resolveMcpFileRoots = (roots: readonly McpFileRoot[] | undefined): McpFileRoot[] => {
  if (!roots || roots.length === 0) {
    return []
  }

  const seen = new Set<string>()

  return roots.filter((root) => {
    if (!root.rootPath || seen.has(root.rootPath)) {
      return false
    }

    seen.add(root.rootPath)
    return true
  })
}
