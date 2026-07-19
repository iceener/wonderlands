import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { IgnoreRule } from './ignore-rules'
import { isIgnored, readIgnoreRules } from './ignore-rules'
import { normalizeSeparators, toDepth, toFileExtension } from './path-utils'
import type { WorkspaceIndexedEntry } from './types'

const FILE_INDEX_TTL_MS = 30_000
const MAX_CACHED_INDEXES = 5

const HARD_EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  '.obsidian',
  '.svelte-kit',
  '__pycache__',
  'dist',
  'node_modules',
  'target',
])

export const buildWorkspaceIndex = async (rootPath: string): Promise<WorkspaceIndexedEntry[]> => {
  const entries: WorkspaceIndexedEntry[] = []

  const walk = async (
    directoryPath: string,
    basePath: string,
    inheritedRules: readonly IgnoreRule[],
  ): Promise<void> => {
    const localRules = await readIgnoreRules(directoryPath, basePath)
    const activeRules = inheritedRules.concat(localRules)
    const children = await readdir(directoryPath, {
      withFileTypes: true,
    })

    for (const child of children) {
      const relativePath = normalizeSeparators(basePath ? join(basePath, child.name) : child.name)
      const isDirectory = child.isDirectory()

      if (isDirectory && HARD_EXCLUDED_DIRECTORY_NAMES.has(child.name)) {
        continue
      }

      if (basePath === '' && isDirectory && child.name === 'attachments') {
        continue
      }

      if (isIgnored(activeRules, relativePath, child.name, isDirectory)) {
        continue
      }

      const absolutePath = join(directoryPath, child.name)

      if (isDirectory) {
        await walk(absolutePath, relativePath, activeRules)
        continue
      }

      const fileName = basename(relativePath)
      let mtimeMs = 0

      try {
        const fileStat = await stat(absolutePath)
        mtimeMs = fileStat.mtimeMs
      } catch {
        // File may have been removed between readdir and stat
      }

      entries.push({
        depth: toDepth(relativePath),
        extension: toFileExtension(relativePath),
        fileName,
        mtimeMs,
        nameLower: fileName.toLowerCase(),
        pathLower: relativePath.toLowerCase(),
        relativePath,
        source: 'workspace',
      })
    }
  }

  await walk(rootPath, '', [])

  return entries
}

export class WorkspaceIndexManager {
  private readonly cache = new Map<
    string,
    { entries: WorkspaceIndexedEntry[]; expiresAt: number }
  >()

  async get(rootPath: string): Promise<WorkspaceIndexedEntry[]> {
    const canonicalRoot = await realpath(rootPath).catch(() => resolve(rootPath))
    const cached = this.cache.get(canonicalRoot)
    const now = Date.now()

    if (cached && cached.expiresAt > now) {
      this.cache.delete(canonicalRoot)
      this.cache.set(canonicalRoot, cached)
      return cached.entries
    }

    const entries = await buildWorkspaceIndex(canonicalRoot)
    this.cache.delete(canonicalRoot)
    this.cache.set(canonicalRoot, {
      entries,
      expiresAt: now + FILE_INDEX_TTL_MS,
    })

    while (this.cache.size > MAX_CACHED_INDEXES) {
      const oldestKey = this.cache.keys().next().value

      if (!oldestKey) {
        break
      }

      this.cache.delete(oldestKey)
    }

    return entries
  }
}

export const workspaceIndexManager = new WorkspaceIndexManager()
