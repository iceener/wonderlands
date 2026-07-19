import { access, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { createFileRepository } from '../persistence/repositories'
import type { AppDatabase } from '../../db/client'
import type { FileRecord } from '../../domain/files/file-repository'
import type { DomainError } from '../../shared/errors'
import type { FileId, WorkSessionId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { createResourceAccessService } from '../access/resource-access'
import { createWorkspaceService } from '../workspaces/workspace-service'

const FILE_INDEX_TTL_MS = 30_000
const MAX_CACHED_INDEXES = 5
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 50

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

interface IgnoreRule {
  basePath: string
  basenameOnly: boolean
  directoryOnly: boolean
  negated: boolean
  pattern: RegExp
}

interface WorkspaceIndexedEntry {
  depth: number
  extension: string
  fileName: string
  mtimeMs: number
  nameLower: string
  pathLower: string
  relativePath: string
  source: 'workspace'
}

interface AttachmentIndexedEntry {
  accessScope: FileRecord['accessScope']
  depth: number
  extension: string
  fileId: FileId
  fileName: string
  mimeType: string | null
  mtimeMs: number
  nameLower: string
  pathLower: string
  relativePath: string
  sizeBytes: number | null
  source: 'attachment'
}

interface McpIndexedEntry {
  depth: number
  extension: string
  fileName: string
  mtimeMs: number
  nameLower: string
  pathLower: string
  relativePath: string
  source: 'mcp'
}

type IndexedEntry = WorkspaceIndexedEntry | AttachmentIndexedEntry | McpIndexedEntry

export interface FilePickerSearchResultItem {
  accessScope: FileRecord['accessScope'] | null
  depth: number
  extension: string | null
  fileId: FileId | null
  label: string
  matchIndices: number[]
  mentionText: string
  mimeType: string | null
  relativePath: string
  sizeBytes: number | null
  source: 'attachment' | 'workspace' | 'mcp'
}

export interface McpFileRoot {
  mountId: string
  rootPath: string
}

export interface SearchFilePickerInput {
  limit?: number
  query?: string
  sessionId?: WorkSessionId | null
}

const normalizeSeparators = (value: string): string => value.replace(/\\/g, '/')

const normalizeBlobStorageKey = (storageKey: string): string => {
  const normalized = normalizeSeparators(storageKey).replace(/^\/+/, '')

  if (normalized.startsWith('files/') || normalized.startsWith('workspaces/')) {
    return normalized
  }

  return `files/${normalized}`
}

const resolveBlobStoragePath = (fileStorageRoot: string, storageKey: string): string => {
  const blobRoot = resolve(fileStorageRoot, '..')
  const normalizedStorageKey = normalizeBlobStorageKey(storageKey)
  const resolvedRoot = resolve(blobRoot)
  const resolvedPath = resolve(resolvedRoot, normalizedStorageKey)

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`storage key ${storageKey} resolves outside configured blob root`)
  }

  return resolvedPath
}

const escapeRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')

const globToRegex = (pattern: string): RegExp => {
  let output = '^'

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    const nextCharacter = pattern[index + 1]

    if (character === '*' && nextCharacter === '*') {
      output += '.*'
      index += 1
      continue
    }

    if (character === '*') {
      output += '[^/]*'
      continue
    }

    if (character === '?') {
      output += '[^/]'
      continue
    }

    output += escapeRegex(character)
  }

  output += '$'
  return new RegExp(output)
}

const compileIgnoreRule = (basePath: string, line: string): IgnoreRule | null => {
  const trimmed = line.trim()

  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  const negated = trimmed.startsWith('!')
  let patternSource = negated ? trimmed.slice(1).trim() : trimmed

  if (!patternSource) {
    return null
  }

  const directoryOnly = patternSource.endsWith('/')
  if (directoryOnly) {
    patternSource = patternSource.slice(0, -1)
  }

  const anchored = patternSource.startsWith('/')
  if (anchored) {
    patternSource = patternSource.slice(1)
  }

  const basenameOnly = !patternSource.includes('/')
  const scopedPattern = basenameOnly
    ? patternSource
    : normalizeSeparators(
        basePath
          ? anchored
            ? join(basePath, patternSource)
            : join(basePath, patternSource)
          : patternSource,
      )

  return {
    basePath: normalizeSeparators(basePath),
    basenameOnly,
    directoryOnly,
    negated,
    pattern: globToRegex(scopedPattern),
  }
}

const matchIgnoreRule = (
  rule: IgnoreRule,
  relativePath: string,
  name: string,
  isDirectory: boolean,
): boolean => {
  if (rule.directoryOnly && !isDirectory) {
    return false
  }

  if (rule.basenameOnly) {
    if (
      rule.basePath &&
      relativePath !== rule.basePath &&
      !relativePath.startsWith(`${rule.basePath}/`)
    ) {
      return false
    }

    return rule.pattern.test(name)
  }

  return rule.pattern.test(relativePath)
}

const isIgnored = (
  rules: readonly IgnoreRule[],
  relativePath: string,
  name: string,
  isDirectory: boolean,
): boolean => {
  let ignored = false

  for (const rule of rules) {
    if (matchIgnoreRule(rule, relativePath, name, isDirectory)) {
      ignored = !rule.negated
    }
  }

  return ignored
}

const readIgnoreRules = async (directoryPath: string, basePath: string): Promise<IgnoreRule[]> => {
  const ruleFiles = ['.gitignore', '.cursorignore']
  const rules: IgnoreRule[] = []

  for (const fileName of ruleFiles) {
    const filePath = join(directoryPath, fileName)
    const content = await readFile(filePath, 'utf8').catch(() => null)

    if (!content) {
      continue
    }

    for (const line of content.split(/\r?\n/)) {
      const compiled = compileIgnoreRule(basePath, line)

      if (compiled) {
        rules.push(compiled)
      }
    }
  }

  return rules
}

const toFileExtension = (value: string): string => extname(value).slice(1).toLowerCase()

const toDepth = (value: string): number => (value.match(/\//g) ?? []).length

const buildWorkspaceIndex = async (rootPath: string): Promise<WorkspaceIndexedEntry[]> => {
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

class WorkspaceIndexManager {
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

const workspaceIndexManager = new WorkspaceIndexManager()

// Index each filesystem-MCP mount root with the same walk/ignore/scoring used
// for the workspace vault, then mount-qualify the paths (e.g. `docs/notes/a.md`)
// so a picked entry inserts a reference the agent can read with its fs_* tools.
const buildMcpEntries = async (roots: readonly McpFileRoot[]): Promise<McpIndexedEntry[]> => {
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

const extensionBoost = (extension: string): number => {
  switch (extension) {
    case 'rs':
    case 'ts':
    case 'tsx':
    case 'svelte':
    case 'js':
    case 'jsx':
    case 'vue':
      return 50
    case 'py':
    case 'go':
    case 'java':
    case 'kt':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'cs':
      return 40
    case 'rb':
    case 'php':
    case 'swift':
    case 'scala':
    case 'clj':
      return 35
    case 'html':
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return 30
    case 'json':
    case 'toml':
    case 'yaml':
    case 'yml':
      return 20
    case 'md':
    case 'txt':
    case 'rst':
      return 10
    default:
      return 0
  }
}

const fuzzyIndices = (
  target: string,
  query: string,
): { indices: number[]; score: number } | null => {
  if (!query) {
    return {
      indices: [],
      score: 0,
    }
  }

  const indices: number[] = []
  let queryIndex = 0

  for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
    if (target[targetIndex] !== query[queryIndex]) {
      continue
    }

    indices.push(targetIndex)
    queryIndex += 1

    if (queryIndex === query.length) {
      break
    }
  }

  if (queryIndex !== query.length) {
    return null
  }

  let score = query.length * 100

  for (let index = 0; index < indices.length; index += 1) {
    const matchedIndex = indices[index]
    const previousCharacter = matchedIndex > 0 ? target[matchedIndex - 1] : ''

    if (
      matchedIndex === 0 ||
      previousCharacter === '/' ||
      previousCharacter === '-' ||
      previousCharacter === '_' ||
      previousCharacter === '.' ||
      previousCharacter === ' '
    ) {
      score += 15
    }

    if (index > 0 && matchedIndex === indices[index - 1] + 1) {
      score += 25
    }
  }

  const exactIndex = target.indexOf(query)
  if (exactIndex >= 0) {
    score += 200

    if (exactIndex === 0) {
      score += 200
    }
  }

  return {
    indices,
    score,
  }
}

const dedupeSortedIndices = (indices: readonly number[]): number[] =>
  [...new Set(indices)].sort((left, right) => left - right)

const mapNameIndicesToPathIndices = (entry: IndexedEntry, indices: readonly number[]): number[] => {
  const startIndex = entry.relativePath.length - entry.fileName.length
  return indices.map((index) => startIndex + index)
}

interface ScoredEntry {
  entry: IndexedEntry
  matchIndices: number[]
  score: number
}

class TopKHeap {
  private readonly values: ScoredEntry[] = []

  constructor(private readonly maxSize: number) {}

  push(candidate: ScoredEntry): void {
    if (this.maxSize <= 0) {
      return
    }

    if (this.values.length < this.maxSize) {
      this.values.push(candidate)
      this.bubbleUp(this.values.length - 1)
      return
    }

    if (this.values[0] && candidate.score <= this.values[0].score) {
      return
    }

    this.values[0] = candidate
    this.bubbleDown(0)
  }

  toSortedArray(): ScoredEntry[] {
    return this.values
      .slice()
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.entry.relativePath.localeCompare(right.entry.relativePath),
      )
  }

  private bubbleUp(startIndex: number): void {
    let index = startIndex

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)

      if (this.values[parentIndex]!.score <= this.values[index]!.score) {
        break
      }

      ;[this.values[parentIndex], this.values[index]] = [
        this.values[index]!,
        this.values[parentIndex]!,
      ]
      index = parentIndex
    }
  }

  private bubbleDown(startIndex: number): void {
    let index = startIndex

    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = index * 2 + 2
      let smallestIndex = index

      if (
        leftIndex < this.values.length &&
        this.values[leftIndex]!.score < this.values[smallestIndex]!.score
      ) {
        smallestIndex = leftIndex
      }

      if (
        rightIndex < this.values.length &&
        this.values[rightIndex]!.score < this.values[smallestIndex]!.score
      ) {
        smallestIndex = rightIndex
      }

      if (smallestIndex === index) {
        break
      }

      ;[this.values[index], this.values[smallestIndex]] = [
        this.values[smallestIndex]!,
        this.values[index]!,
      ]
      index = smallestIndex
    }
  }
}

const recencyBoost = (mtimeMs: number, nowMs: number): number => {
  if (mtimeMs <= 0) {
    return 0
  }

  const ageHours = Math.max(0, nowMs - mtimeMs) / (1000 * 60 * 60)

  return Math.round(500 * 0.97 ** ageHours)
}

const scoreEntry = (
  entry: IndexedEntry,
  normalizedQuery: string,
  nowMs: number = Date.now(),
): { matchIndices: number[]; score: number } | null => {
  if (!normalizedQuery) {
    return {
      matchIndices: [],
      score: recencyBoost(entry.mtimeMs, nowMs) + extensionBoost(entry.extension) - entry.depth * 5,
    }
  }

  if (normalizedQuery.includes(' ')) {
    const parts = normalizedQuery.split(/\s+/).filter(Boolean)

    if (parts.length === 0) {
      return {
        matchIndices: [],
        score:
          recencyBoost(entry.mtimeMs, nowMs) + extensionBoost(entry.extension) - entry.depth * 5,
      }
    }

    let score = 0
    const collectedIndices: number[] = []

    for (const part of parts) {
      const match = fuzzyIndices(entry.pathLower, part)

      if (!match) {
        return null
      }

      score += match.score
      collectedIndices.push(...match.indices)
    }

    const lastPart = parts.at(-1) ?? ''
    if (lastPart) {
      if (entry.nameLower.includes(lastPart)) {
        score += 5_000
      }

      if (entry.nameLower.startsWith(lastPart)) {
        score += 10_000
      }
    }

    score += extensionBoost(entry.extension)
    score -= entry.depth * 10

    return {
      matchIndices: dedupeSortedIndices(collectedIndices),
      score,
    }
  }

  const queryIsFilenameLike = normalizedQuery.includes('.') || !normalizedQuery.includes('/')
  const nameMatch = fuzzyIndices(entry.nameLower, normalizedQuery)
  const pathMatch = fuzzyIndices(entry.pathLower, normalizedQuery)

  if (!nameMatch && !pathMatch) {
    return null
  }

  if (!nameMatch && pathMatch && queryIsFilenameLike) {
    if (!entry.pathLower.includes(normalizedQuery)) {
      return null
    }
  }

  let score = 0
  const collectedIndices: number[] = []

  if (nameMatch && pathMatch) {
    score += nameMatch.score * 2 + pathMatch.score
    collectedIndices.push(
      ...pathMatch.indices,
      ...mapNameIndicesToPathIndices(entry, nameMatch.indices),
    )
  } else if (nameMatch) {
    score += nameMatch.score * 2
    collectedIndices.push(...mapNameIndicesToPathIndices(entry, nameMatch.indices))
  } else if (pathMatch) {
    score += pathMatch.score
    collectedIndices.push(...pathMatch.indices)
  }

  if (entry.nameLower === normalizedQuery) {
    score += 100_000
  }

  if (entry.nameLower.startsWith(normalizedQuery)) {
    score += 10_000
  }

  if (entry.nameLower.includes(normalizedQuery)) {
    score += 1_000
  }

  score += extensionBoost(entry.extension)
  score -= entry.depth * 10

  return {
    matchIndices: dedupeSortedIndices(collectedIndices),
    score,
  }
}

const toAttachmentEntry = (file: FileRecord): AttachmentIndexedEntry => {
  const label = (file.originalFilename ?? file.title ?? file.id).trim() || file.id

  return {
    accessScope: file.accessScope,
    depth: 0,
    extension: toFileExtension(label),
    fileId: file.id,
    fileName: label,
    mimeType: file.mimeType,
    mtimeMs: file.updatedAt ? new Date(file.updatedAt).getTime() : 0,
    nameLower: label.toLowerCase(),
    pathLower: label.toLowerCase(),
    relativePath: label,
    sizeBytes: file.sizeBytes,
    source: 'attachment',
  }
}

const dedupeAttachments = (files: readonly FileRecord[]): AttachmentIndexedEntry[] => {
  const deduped = new Map<string, AttachmentIndexedEntry>()

  for (const file of files) {
    if (deduped.has(file.id)) {
      continue
    }

    deduped.set(file.id, toAttachmentEntry(file))
  }

  return [...deduped.values()]
}

const filterFilesWithPresentBlobs = async (
  files: readonly FileRecord[],
  fileStorageRoot: string,
): Promise<FileRecord[]> => {
  const settled = await Promise.all(
    files.map(async (file) => {
      try {
        await access(resolveBlobStoragePath(fileStorageRoot, file.storageKey))
        return file
      } catch {
        return null
      }
    }),
  )

  return settled.filter((file): file is FileRecord => file !== null)
}

const clampLimit = (value: number | undefined): number => {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_LIMIT
  }

  return Math.min(Math.max(Math.floor(value), 1), MAX_LIMIT)
}

const toSearchResultItem = (candidate: ScoredEntry): FilePickerSearchResultItem => {
  if (candidate.entry.source === 'attachment') {
    return {
      accessScope: candidate.entry.accessScope,
      depth: candidate.entry.depth,
      extension: candidate.entry.extension || null,
      fileId: candidate.entry.fileId,
      label: candidate.entry.fileName,
      matchIndices: candidate.matchIndices,
      mentionText: candidate.entry.fileName,
      mimeType: candidate.entry.mimeType,
      relativePath: candidate.entry.relativePath,
      sizeBytes: candidate.entry.sizeBytes,
      source: candidate.entry.source,
    }
  }

  return {
    accessScope: null,
    depth: candidate.entry.depth,
    extension: candidate.entry.extension || null,
    fileId: null,
    label: candidate.entry.fileName,
    matchIndices: candidate.matchIndices,
    mentionText: candidate.entry.relativePath,
    mimeType: null,
    relativePath: candidate.entry.relativePath,
    sizeBytes: null,
    source: candidate.entry.source,
  }
}

const resolveMcpFileRoots = (roots: readonly McpFileRoot[] | undefined): McpFileRoot[] => {
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

export const searchFilePicker = async (
  db: AppDatabase,
  input: SearchFilePickerInput,
  context: {
    createId: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
    fileStorageRoot: string
    mcpFileRoots?: readonly McpFileRoot[]
    tenantScope: TenantScope
  },
): Promise<Result<FilePickerSearchResultItem[], DomainError>> => {
  const workspaceService = createWorkspaceService(db, {
    createId: context.createId,
    fileStorageRoot: context.fileStorageRoot,
  })
  const workspace = workspaceService.ensureAccountWorkspace(context.tenantScope, {
    nowIso: new Date().toISOString(),
  })

  if (!workspace.ok) {
    return workspace
  }

  const workspaceEntries = await workspaceIndexManager.get(
    workspaceService.ensureVaultRef(workspace.value),
  )
  const fileRepository = createFileRepository(db)
  const accountLibraryFiles = fileRepository.listAccountLibraryByAccountId(context.tenantScope)

  if (!accountLibraryFiles.ok) {
    return accountLibraryFiles
  }

  let sessionFiles: FileRecord[] = []
  if (input.sessionId) {
    const sessionRecord = createResourceAccessService(db).requireSessionAccess(
      context.tenantScope,
      input.sessionId,
    )

    if (!sessionRecord.ok) {
      return sessionRecord
    }

    const linkedFiles = fileRepository.listBySessionId(context.tenantScope, input.sessionId)

    if (!linkedFiles.ok) {
      return linkedFiles
    }

    sessionFiles = linkedFiles.value
  }

  const availableAttachmentFiles = await filterFilesWithPresentBlobs(
    [...sessionFiles, ...accountLibraryFiles.value],
    context.fileStorageRoot,
  )
  const attachmentEntries = dedupeAttachments(availableAttachmentFiles)
  const mcpEntries = await buildMcpEntries(resolveMcpFileRoots(context.mcpFileRoots))
  const normalizedQuery = (input.query ?? '').trim().toLowerCase()
  const heap = new TopKHeap(clampLimit(input.limit))

  for (const entry of [...workspaceEntries, ...attachmentEntries, ...mcpEntries]) {
    const scored = scoreEntry(entry, normalizedQuery)

    if (!scored) {
      continue
    }

    heap.push({
      entry,
      matchIndices: scored.matchIndices,
      score: scored.score,
    })
  }

  return ok(heap.toSortedArray().map(toSearchResultItem))
}
