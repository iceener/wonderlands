import { createGardenSiteRepository } from '../../adapters/persistence/sqlite'
import { createAgentRevisionRepository } from '../../adapters/persistence/sqlite/agents/agent-revision-repository'
import type { RepositoryDatabase } from '../../db/repository-database'
import type {
  GardenProtectedAccessMode,
  GardenSiteStatus,
} from '../../domain/garden/garden-site-repository'
import type { SandboxVaultAccessMode } from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import type { AgentRevisionId, GardenSiteId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import { ok } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { parseSandboxPolicyJson } from '../sandbox/sandbox-policy'
import { gardenFrontmatterReferenceRelativePath } from './meta-files'

const gardenConfigFilename = '_garden.yml'
const gardenPublishableAssetsRoot = 'public'
const gardenPrivateRoots = ['_meta', 'attachments', 'system'] as const
const gardenStatusRank: Record<GardenSiteStatus, number> = {
  active: 0,
  draft: 1,
  disabled: 2,
  archived: 3,
}

export interface GardenAgentContextSite {
  configPath: string
  frontmatterReferencePath: string
  id: GardenSiteId
  isDefault: boolean
  name: string
  preferred: boolean
  protectedAccessMode: GardenProtectedAccessMode
  publicPath: string
  slug: string
  sourceRoot: string
  sourceScopePath: string
  status: GardenSiteStatus
}

export interface GardenAgentContext {
  accountVaultRoot: '/vault'
  configFilename: '_garden.yml'
  gardens: GardenAgentContextSite[]
  preferredSlugs: string[]
  privateRoots: readonly ['_meta', 'attachments', 'system']
  publishableAssetsRoot: 'public'
  recommendedGarden: GardenAgentContextSite | null
  sandbox: {
    enabled: boolean
    vaultMode: SandboxVaultAccessMode
  }
}

export const getAssignedGardenSites = (
  context: Pick<GardenAgentContext, 'gardens' | 'preferredSlugs'>,
): GardenAgentContextSite[] => {
  if (context.preferredSlugs.length === 0) {
    return [...context.gardens]
  }

  const assigned = new Set(context.preferredSlugs)

  return context.gardens.filter((site) => assigned.has(site.slug))
}

const normalizePreferredSlugs = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      )
    : []

const loadPreferredSlugs = (
  db: RepositoryDatabase,
  scope: TenantScope,
  agentRevisionId: AgentRevisionId | null,
): string[] => {
  if (!agentRevisionId) {
    return []
  }

  const revision = createAgentRevisionRepository(db).getById(scope, agentRevisionId)

  if (!revision.ok) {
    return []
  }

  return normalizePreferredSlugs(revision.value.gardenFocusJson.preferredSlugs)
}

const loadSandboxContext = (
  db: RepositoryDatabase,
  scope: TenantScope,
  agentRevisionId: AgentRevisionId | null,
): GardenAgentContext['sandbox'] => {
  if (!agentRevisionId) {
    return {
      enabled: false,
      vaultMode: 'none',
    }
  }

  const revision = createAgentRevisionRepository(db).getById(scope, agentRevisionId)

  if (!revision.ok) {
    return {
      enabled: false,
      vaultMode: 'none',
    }
  }

  const sandboxPolicy = parseSandboxPolicyJson(revision.value.sandboxPolicyJson)

  if (!sandboxPolicy.ok) {
    return {
      enabled: false,
      vaultMode: 'none',
    }
  }

  return {
    enabled: sandboxPolicy.value.enabled,
    vaultMode: sandboxPolicy.value.vault.mode,
  }
}

const toSourceRoot = (sourceScopePath: string): string => {
  const normalized = sourceScopePath.trim()

  return normalized.length === 0 || normalized === '.' ? '/vault' : `/vault/${normalized}`
}

const toChildPath = (root: string, child: string): string =>
  root === '/vault' ? `/vault/${child}` : `${root}/${child}`

const toPreferredIndex = (preferredSlugs: string[]): Map<string, number> =>
  new Map(preferredSlugs.map((slug, index) => [slug, index]))

export const loadGardenAgentContext = (
  db: RepositoryDatabase,
  scope: TenantScope,
  agentRevisionId: AgentRevisionId | null,
): Result<GardenAgentContext, DomainError> => {
  const preferredSlugs = loadPreferredSlugs(db, scope, agentRevisionId)
  const sandbox = loadSandboxContext(db, scope, agentRevisionId)
  const preferredIndex = toPreferredIndex(preferredSlugs)
  const listed = createGardenSiteRepository(db).listByTenant(scope)

  if (!listed.ok) {
    return listed
  }

  const gardens = listed.value
    .filter((site) => site.createdByAccountId === scope.accountId)
    .map((site) => {
      const sourceRoot = toSourceRoot(site.sourceScopePath)

      return {
        configPath: toChildPath(sourceRoot, gardenConfigFilename),
        frontmatterReferencePath: toChildPath(sourceRoot, gardenFrontmatterReferenceRelativePath),
        id: site.id,
        isDefault: site.isDefault,
        name: site.name,
        preferred: preferredIndex.has(site.slug),
        protectedAccessMode: site.protectedAccessMode,
        publicPath: toChildPath(sourceRoot, gardenPublishableAssetsRoot),
        slug: site.slug,
        sourceRoot,
        sourceScopePath: site.sourceScopePath,
        status: site.status,
      } satisfies GardenAgentContextSite
    })
    .sort((left, right) => {
      const leftPreferredIndex = preferredIndex.get(left.slug)
      const rightPreferredIndex = preferredIndex.get(right.slug)

      if (leftPreferredIndex !== undefined || rightPreferredIndex !== undefined) {
        if (leftPreferredIndex === undefined) {
          return 1
        }

        if (rightPreferredIndex === undefined) {
          return -1
        }

        return leftPreferredIndex - rightPreferredIndex
      }

      return (
        Number(right.isDefault) - Number(left.isDefault) ||
        gardenStatusRank[left.status] - gardenStatusRank[right.status] ||
        left.slug.localeCompare(right.slug) ||
        left.id.localeCompare(right.id)
      )
    })

  return ok({
    accountVaultRoot: '/vault',
    configFilename: gardenConfigFilename,
    gardens,
    preferredSlugs,
    privateRoots: gardenPrivateRoots,
    publishableAssetsRoot: gardenPublishableAssetsRoot,
    recommendedGarden: gardens[0] ?? null,
    sandbox,
  })
}

export const formatGardenContextDeveloperMessage = (
  context: GardenAgentContext | null,
  options: {
    includeExecuteHint?: boolean
    includeToolHint: boolean
    includeSandboxHint: boolean
    includeJustBashHint?: boolean
  },
): string | null => {
  if (!context || context.gardens.length === 0) {
    return null
  }

  const lines = [
    'Garden context:',
    '',
    `Garden sites are file-first websites built from the current account workspace under ${context.accountVaultRoot}.`,
    '',
    'How to navigate:',
    `- Use ${context.accountVaultRoot} paths with file tools, not tenant/account filesystem paths.`,
    '- Garden is file-first editorial state. Treat `_garden.yml`, markdown files, and `public/**` assets in the selected source root as the source of truth, not a separate CMS/database view.',
    `- Each garden source scope root must contain ${context.configFilename}.`,
    `- Each garden source root also keeps a private frontmatter reference at <garden-root>/${gardenFrontmatterReferenceRelativePath}. Read it when you need the full page field list or example syntax.`,
    `- Publishable assets live under ${context.publishableAssetsRoot}/.`,
    `- In Garden markdown, embed publishable assets with /${context.publishableAssetsRoot}/... or ${context.publishableAssetsRoot}/... paths, not guessed final site URLs.`,
    `- Treat ${context.privateRoots.join(', ')} as private, not publishable.`,
    '',
    'Protected routes:',
    `- visibility: protected still requires the page path to be included by ${context.configFilename} publishing roots; visibility: private publishes no route at all.`,
    '- Protected pages are hidden from the public menu/sidebar, so reach them through a direct link or direct URL.',
    '- Site passwords unlock only protected routes. Public pages stay public.',
    '- Open the protected page at its normal route, then unlock it there. Default gardens use /page-path with /_auth/unlock. Non-default gardens use /<garden-slug>/page-path with /<garden-slug>/_auth/unlock.',
    '- A successful unlock sets the site cookie for that garden and redirects back to the protected route.',
    '',
    'Available gardens in this workspace:',
    ...context.gardens.map((site) => {
      const qualifiers = [
        ...(site.isDefault ? ['default'] : []),
        site.status,
        ...(site.preferred ? ['preferred'] : []),
        ...(site.protectedAccessMode !== 'none' ? [`protected=${site.protectedAccessMode}`] : []),
      ]

      return `- ${site.slug} (${qualifiers.join(', ')}) -> ${site.sourceRoot}`
    }),
  ]

  if (options.includeSandboxHint && context.sandbox.enabled) {
    const sandboxLines =
      context.sandbox.vaultMode === 'read_write'
        ? [
            'Garden + sandbox workflow:',
            ...(options.includeExecuteHint
              ? [
                  '- Prefer execute for Garden file manipulation, shell-style inspection, and lightweight staged edits.',
                  '- Use execute as the default choice for `find`, `rg`, `grep`, `ls`, `cat`, `head`, `tail`, `sed`, and simple pipes over staged Garden files. It defaults to `mode: "bash"` when mode is omitted.',
                  `- In execute bash mode, the selected Garden keeps its resolved /vault source root. For this garden, \`garden: "${context.recommendedGarden?.slug ?? context.gardens[0]?.slug ?? 'garden-slug'}"\` starts the run in \`${context.recommendedGarden?.sourceRoot ?? context.gardens[0]?.sourceRoot ?? '/vault'}\`, so prefer relative paths like \`_garden.yml\`, \`_meta/frontmatter.md\`, or \`music/deep-house/nora.md\` from \`pwd\`.`,
                  '- When writing back to the selected Garden, `outputs.writeBack[].toVaultPath: "."` targets that Garden root directly.',
                  '- execute bash mode uses just-bash, not host bash. Do not probe for system binaries like `magick`, `ffmpeg`, or `sips` with `which` there.',
                  '- execute bash mode is bash-like but not GNU-complete. Prefer conservative flags, avoid assuming options like `grep -H` or `grep -I` exist, and prefer direct recursive `grep` or `rg` over `find | while read ...` loops for simple searches.',
                  '- When a search may legitimately return no matches, append `|| true` so exit code `1` does not fail the whole execute call.',
                  '- Use execute with `mode: "script"` when you need custom JavaScript, MCP code-mode scripts, npm packages, or structured parsing/transforms.',
                  '- In execute `mode: "script"`, inline JavaScript normally runs as an ES module. Prefer `await import(...)`, avoid `require(...)`, and outside MCP code mode do not use top-level `return`. When MCP code mode is active, write a script body, not a full module: the runtime wraps your code in an async function, so `return` is allowed there but static top-level `import`/`export` is not.',
                  '- execute can edit staged Garden files during the run, but real Garden persistence still requires `outputs.writeBack` plus `commit_sandbox_writeback`.',
                ]
              : [
                  '- Prefer execute for Garden file manipulation when the task spans multiple files or needs generated output.',
                ]),
            `- For this garden, prefer garden: "${context.recommendedGarden?.slug ?? context.gardens[0]?.slug ?? 'garden-slug'}" instead of manual vaultInputs/cwdVaultPath. The server will mount that garden root and use it as the sandbox working directory automatically.`,
            `- In sandbox jobs, read Garden source from ${context.accountVaultRoot}/... only after mounting it with garden, vaultInputs, or cwdVaultPath. Attachments appear under /input/... when staged.`,
            '- Write generated files under /output/... and use outputs.writeBack to request changes back into /vault/.',
          ]
        : context.sandbox.vaultMode === 'read_only'
          ? [
              'Garden + sandbox workflow:',
              ...(options.includeExecuteHint
                ? [
                    '- Prefer execute for Garden analysis, shell-style inspection, and transforms that should not write back directly.',
                    '- Use execute as the default choice for `find`, `rg`, `grep`, `ls`, `cat`, `head`, `tail`, `sed`, and simple pipes over staged Garden files. It defaults to `mode: "bash"` when mode is omitted.',
                    `- In execute bash mode, the selected Garden keeps its resolved /vault source root. For this garden, \`garden: "${context.recommendedGarden?.slug ?? context.gardens[0]?.slug ?? 'garden-slug'}"\` starts the run in \`${context.recommendedGarden?.sourceRoot ?? context.gardens[0]?.sourceRoot ?? '/vault'}\`, so prefer relative paths like \`_garden.yml\`, \`_meta/frontmatter.md\`, or content paths from \`pwd\`. Use absolute \`${context.recommendedGarden?.sourceRoot ?? context.gardens[0]?.sourceRoot ?? '/vault'}/...\` only when a tool argument truly requires it.`,
                    '- When writing back to the selected Garden, `outputs.writeBack[].toVaultPath: "."` targets that Garden root directly.',
                    '- execute bash mode uses just-bash, not host bash. Do not probe for system binaries like `magick`, `ffmpeg`, or `sips` with `which` there.',
                    '- execute bash mode is bash-like but not GNU-complete. Prefer conservative flags, avoid assuming options like `grep -H` or `grep -I` exist, and prefer direct recursive `grep` or `rg` over `find | while read ...` loops for simple searches.',
                    '- When a search may legitimately return no matches, append `|| true` so exit code `1` does not fail the whole execute call.',
                    '- Use execute with `mode: "script"` when you need custom JavaScript, MCP code-mode scripts, npm packages, or structured parsing/transforms.',
                    '- In execute `mode: "script"`, inline JavaScript normally runs as an ES module. Prefer `await import(...)`, avoid `require(...)`, and outside MCP code mode do not use top-level `return`. When MCP code mode is active, write a script body, not a full module: the runtime wraps your code in an async function, so `return` is allowed there but static top-level `import`/`export` is not.',
                  ]
                : [
                    '- Prefer execute for Garden analysis or transforms that should not write back directly.',
                  ]),
              `- For this garden, prefer garden: "${context.recommendedGarden?.slug ?? context.gardens[0]?.slug ?? 'garden-slug'}" instead of manual vaultInputs/cwdVaultPath. The server will mount that garden root and use it as the sandbox working directory automatically.`,
              `- In sandbox jobs, read Garden source from ${context.accountVaultRoot}/... only after mounting it with garden, vaultInputs, or cwdVaultPath. Attachments appear under /input/... when staged.`,
              '- Sandbox vault access is read-only for this agent, so Garden edits cannot be written back from the sandbox.',
            ]
          : [
              'Garden + sandbox workflow:',
              '- Sandbox jobs are available, but this agent does not have /vault access inside the sandbox.',
              '- Use sandbox for attachment processing or generated outputs, and use direct file tools for Garden files.',
            ]

    lines.push('', ...sandboxLines)

    if (options.includeJustBashHint) {
      if (options.includeExecuteHint) {
        lines.push(
          '- execute bash mode uses just-bash under the hood, so prefer execute over hand-written just-bash wrapper code.',
          '- execute bash mode only exposes the curated just-bash command set, not arbitrary host executables.',
          '- For inline execute calls, prefer the flat form with top-level `script`, for example `{ "mode": "bash", "garden": "overment", "script": "grep -r \\"nora\\" . || true", "task": "Search for Nora" }`. Do not pass `source` as a bare string.',
          '- Prefer direct recursive `grep` or `rg` over per-file shell loops for simple searches, and add `|| true` when a no-match result is acceptable.',
          '- Use execute with `mode: "script"` only when you need custom scripts, MCP code-mode scripts, npm packages, or structured parsing/transforms.',
          '- In execute `mode: "script"`, inline JavaScript normally runs as an ES module. Prefer `await import(...)`, avoid `require(...)`, and outside MCP code mode do not use top-level `return`. When MCP code mode is active, write a script body, not a full module: the runtime wraps your code in an async function, so `return` is allowed there but static top-level `import`/`export` is not.',
          '- Sandbox edits stay sandbox-local until requested through `outputs.writeBack` and later applied by `commit_sandbox_writeback`.',
        )
      } else {
        lines.push(
          '- For shell-style Garden inspection or manipulation in sandbox jobs, prefer just-bash instead of writing a custom fs walker.',
          '- just-bash is already available by default in sandbox jobs. Do not add it in packages[].',
          '- Use just-bash for find/grep/ls/cat/head/tail over mounted Garden files, and do not spawn bash via child_process.',
          '- `new Bash()` is in-memory only; to inspect mounted Garden files, use OverlayFs on the mounted /vault path. Example: `import { Bash, OverlayFs } from "just-bash"; const fs = new OverlayFs({ root: "/vault/overment", readOnly: true }); const bash = new Bash({ fs, cwd: fs.getMountPoint() }); console.log((await bash.exec("grep -RIn \\"nora en pure\\" . || true")).stdout);`',
          '- /vault paths do not appear in the sandbox automatically. Mount them first with garden, vaultInputs, or cwdVaultPath.',
          '- Use raw fs/path code only when you need structured parsing, transforms, or JSON processing.',
        )
      }
    }
  }

  if (options.includeToolHint) {
    lines.push('', 'If you need structured details, call get_garden_context.')
  }

  return lines.join('\n')
}
