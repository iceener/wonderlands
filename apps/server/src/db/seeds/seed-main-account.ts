import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { z } from 'zod'

import type { AppRuntime } from '../../app/runtime'
import { hashApiKeySecret } from '../../shared/api-key'
import {
  type AccountId,
  type ApiKeyId,
  asAccountId,
  asAgentId,
  asAgentRevisionId,
  asApiKeyId,
  asTenantId,
  asToolProfileId,
  createPrefixedId,
  type TenantId,
} from '../../shared/ids'
import { hashPassword, normalizeAuthEmail } from '../../shared/password'
import type { TenantRole } from '../../shared/scope'
import {
  accountPreferences,
  accounts,
  agentRevisions,
  agents,
  apiKeys,
  gardenSites,
  passwordCredentials,
  tenantMemberships,
  tenants,
  toolProfiles,
} from '../schema'
import { withTransaction } from '../transaction'

const legacyMainAccountSeedManifestSchema = z.object({
  apiKeySecret: z.string().min(1),
  password: z.string().min(8),
  version: z.literal(2),
})

const mainAccountSeedManifestSchema = z.object({
  accountId: z.string().min(1),
  apiKeyId: z.string().min(1),
  apiKeySecret: z.string().min(1),
  password: z.string().min(8),
  tenantId: z.string().min(1),
  tenantMembershipId: z.string().min(1),
  version: z.literal(3),
})

const anyMainAccountSeedManifestSchema = z.union([
  legacyMainAccountSeedManifestSchema,
  mainAccountSeedManifestSchema,
])

type MainAccountSeedManifest = z.infer<typeof mainAccountSeedManifestSchema>
type AnyMainAccountSeedManifest = z.infer<typeof anyMainAccountSeedManifestSchema>

const isCurrentMainAccountSeedManifest = (
  manifest: AnyMainAccountSeedManifest,
): manifest is MainAccountSeedManifest => manifest.version === 3

const defaultMainAccountSeedInput = {
  accountEmail: 'main@local.test',
  accountName: 'Main Account',
  apiKeyLabel: 'Main local key',
  tenantName: 'Local Workspace',
  tenantRole: 'owner' as TenantRole,
  tenantSlug: 'local-workspace',
}

type MainAccountSeedSecretSource = 'existing' | 'generated'
type MainAccountSeedResolvedSecretSource = MainAccountSeedSecretSource | 'provided'

export interface SeedMainAccountInput {
  accountEmail?: string
  accountId?: AccountId
  accountName?: string
  accountPassword?: string
  apiKeyId?: ApiKeyId
  apiKeyLabel?: string
  apiKeySecret?: string
  seedGarden?: boolean
  tenantId?: TenantId
  tenantMembershipId?: string
  tenantName?: string
  tenantRole?: TenantRole
  tenantSlug?: string
}

export interface MainAccountSeedResult {
  accountEmail: string
  accountId: AccountId
  accountPassword: string
  apiKeyId: ApiKeyId
  apiKeySecret: string
  manifestPath: string
  secretSource: MainAccountSeedResolvedSecretSource
  tenantId: TenantId
  tenantRole: TenantRole
}

type ResolvedMainAccountSeedInput = Required<
  Omit<SeedMainAccountInput, 'accountPassword' | 'apiKeySecret' | 'seedGarden'>
> &
  Pick<SeedMainAccountInput, 'seedGarden'> &
  Pick<SeedMainAccountInput, 'accountPassword' | 'apiKeySecret'>

const createMainAccountApiKeySecret = (): string => `sk_local_${randomBytes(24).toString('hex')}`

const createMainAccountPassword = (): string => `pw_local_${randomBytes(16).toString('hex')}`

const createGeneratedSeedIds = () => ({
  accountId: asAccountId(createPrefixedId('acc')),
  apiKeyId: asApiKeyId(createPrefixedId('key')),
  tenantId: asTenantId(createPrefixedId('ten')),
  tenantMembershipId: createPrefixedId('mem'),
})

const createAssistantToolProfileId = (accountId: AccountId) =>
  asToolProfileId(`tpf_assistant_${accountId.slice(4)}`)

const defaultGardenYml = `schema: garden/v1
title: Wonderlands
description: Welcome to Wonderlands.

public:
  roots:
    - index.md
`

const defaultGardenIndexMd = `---
title: Welcome
description: Your Wonderlands workspace is ready.
publish: true
---

# Welcome to Wonderlands

Your workspace is set up and ready to use.
`

const createAliceAgentId = (accountId: AccountId) => asAgentId(`agt_alice_${accountId.slice(4)}`)

const createAliceRevisionId = (accountId: AccountId) =>
  asAgentRevisionId(`agr_alice_${accountId.slice(4)}`)

const buildAliceSourceMarkdown = (provider: string, modelAlias: string): string =>
  [
    '---',
    'schema: agent/v1',
    'name: Alice',
    'slug: alice',
    'description: Main agent for the workspace.',
    'visibility: tenant_shared',
    'kind: primary',
    'model:',
    `  provider: ${provider}`,
    `  model_alias: ${modelAlias}`,
    'garden:',
    '  preferred_slugs:',
    '    - wonderlands',
    'sandbox:',
    '  enabled: true',
    '  runtime:',
    '    default_engine: node',
    '    allowed_engines:',
    '      - node',
    '    allow_workspace_scripts: false',
    '    max_duration_sec: 120',
    '    max_memory_mb: 512',
    '    max_input_bytes: 25000000',
    '    max_output_bytes: 25000000',
    '    node_version: "22"',
    '  packages:',
    '    mode: disabled',
    '  network:',
    '    mode: open',
    '  vault:',
    '    mode: read_write',
    '    require_approval_for_write: false',
    '    require_approval_for_delete: true',
    '    require_approval_for_move: true',
    '    require_approval_for_workspace_script: true',
    'tools:',
    '  native:',
    '    - web_search',
    '---',
    "You're Alice.",
    '',
  ].join('\n')

const resolveMainAccountSeedManifestPath = (databasePath: string): string =>
  join(dirname(databasePath), 'main-account-seed.json')

const readMainAccountSeedManifest = (manifestPath: string) => {
  if (!existsSync(manifestPath)) {
    return null
  }

  const manifestContent = readFileSync(manifestPath, 'utf8')

  return anyMainAccountSeedManifestSchema.parse(JSON.parse(manifestContent))
}

const writeMainAccountSeedManifest = (
  manifestPath: string,
  input: {
    accountId: AccountId
    apiKeyId: ApiKeyId
    apiKeySecret: string
    password: string
    tenantId: TenantId
    tenantMembershipId: string
  },
): void => {
  mkdirSync(dirname(manifestPath), { recursive: true })

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        accountId: input.accountId,
        apiKeyId: input.apiKeyId,
        apiKeySecret: input.apiKeySecret,
        password: input.password,
        tenantId: input.tenantId,
        tenantMembershipId: input.tenantMembershipId,
        version: 3,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

const resolveMainAccountSecrets = (
  manifestPath: string,
  input: Pick<SeedMainAccountInput, 'accountPassword' | 'apiKeySecret'>,
) => {
  const existingManifest = readMainAccountSeedManifest(manifestPath)
  const existingSecrets = existingManifest
    ? {
        apiKeySecret: existingManifest.apiKeySecret,
        password: existingManifest.password,
        secretSource: 'existing' as const,
      }
    : null

  const generatedSecrets = {
    apiKeySecret: createMainAccountApiKeySecret(),
    password: createMainAccountPassword(),
    secretSource: 'generated' as const,
  }

  const baseSecrets = existingSecrets ?? generatedSecrets

  return {
    apiKeySecret: input.apiKeySecret ?? baseSecrets.apiKeySecret,
    password: input.accountPassword ?? baseSecrets.password,
    secretSource:
      input.apiKeySecret || input.accountPassword
        ? ('provided' as const)
        : baseSecrets.secretSource,
  }
}

const resolveMainAccountSeedInput = (
  input: SeedMainAccountInput,
  manifestPath: string,
): ResolvedMainAccountSeedInput => {
  const definedInput = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as SeedMainAccountInput
  const existingManifest = readMainAccountSeedManifest(manifestPath)

  const resolvedIds =
    definedInput.accountId &&
    definedInput.apiKeyId &&
    definedInput.tenantId &&
    definedInput.tenantMembershipId
      ? {
          accountId: definedInput.accountId,
          apiKeyId: definedInput.apiKeyId,
          tenantId: definedInput.tenantId,
          tenantMembershipId: definedInput.tenantMembershipId,
        }
      : existingManifest && isCurrentMainAccountSeedManifest(existingManifest)
        ? {
            accountId: asAccountId(existingManifest.accountId),
            apiKeyId: asApiKeyId(existingManifest.apiKeyId),
            tenantId: asTenantId(existingManifest.tenantId),
            tenantMembershipId: existingManifest.tenantMembershipId,
          }
        : createGeneratedSeedIds()

  return {
    ...defaultMainAccountSeedInput,
    ...resolvedIds,
    ...definedInput,
  }
}

export const seedMainAccount = (
  runtime: AppRuntime,
  input: SeedMainAccountInput = {},
): MainAccountSeedResult => {
  const manifestPath = resolveMainAccountSeedManifestPath(runtime.config.database.path)
  const seedInput = resolveMainAccountSeedInput(input, manifestPath)
  const { apiKeySecret, password, secretSource } = resolveMainAccountSecrets(manifestPath, input)
  const seededAt = runtime.services.clock.nowIso()
  const hashedSecret = hashApiKeySecret(apiKeySecret)
  const passwordHash = hashPassword(password)
  const assistantToolProfileId = createAssistantToolProfileId(seedInput.accountId)

  writeMainAccountSeedManifest(manifestPath, {
    accountId: seedInput.accountId,
    apiKeyId: seedInput.apiKeyId,
    apiKeySecret,
    password,
    tenantId: seedInput.tenantId,
    tenantMembershipId: seedInput.tenantMembershipId,
  })

  withTransaction(runtime.db, (tx) => {
    tx.insert(accounts)
      .values({
        createdAt: seededAt,
        email: normalizeAuthEmail(seedInput.accountEmail),
        id: seedInput.accountId,
        name: seedInput.accountName,
        preferences: null,
        updatedAt: seededAt,
      })
      .onConflictDoUpdate({
        set: {
          email: normalizeAuthEmail(seedInput.accountEmail),
          name: seedInput.accountName,
          preferences: null,
          updatedAt: seededAt,
        },
        target: accounts.id,
      })
      .run()

    tx.insert(tenants)
      .values({
        createdAt: seededAt,
        id: seedInput.tenantId,
        name: seedInput.tenantName,
        slug: seedInput.tenantSlug,
        status: 'active',
        updatedAt: seededAt,
      })
      .onConflictDoUpdate({
        set: {
          name: seedInput.tenantName,
          slug: seedInput.tenantSlug,
          status: 'active',
          updatedAt: seededAt,
        },
        target: tenants.id,
      })
      .run()

    tx.insert(tenantMemberships)
      .values({
        accountId: seedInput.accountId,
        createdAt: seededAt,
        id: seedInput.tenantMembershipId,
        role: seedInput.tenantRole,
        tenantId: seedInput.tenantId,
      })
      .onConflictDoUpdate({
        set: {
          role: seedInput.tenantRole,
        },
        target: [tenantMemberships.tenantId, tenantMemberships.accountId],
      })
      .run()

    tx.insert(apiKeys)
      .values({
        accountId: seedInput.accountId,
        createdAt: seededAt,
        expiresAt: null,
        hashedSecret,
        id: seedInput.apiKeyId,
        label: seedInput.apiKeyLabel,
        lastFour: apiKeySecret.slice(-4),
        lastUsedAt: null,
        revokedAt: null,
        scopeJson: null,
        status: 'active',
      })
      .onConflictDoUpdate({
        set: {
          accountId: seedInput.accountId,
          expiresAt: null,
          hashedSecret,
          label: seedInput.apiKeyLabel,
          lastFour: apiKeySecret.slice(-4),
          lastUsedAt: null,
          revokedAt: null,
          scopeJson: null,
          status: 'active',
        },
        target: apiKeys.id,
      })
      .run()

    tx.insert(passwordCredentials)
      .values({
        accountId: seedInput.accountId,
        createdAt: seededAt,
        passwordHash,
        updatedAt: seededAt,
      })
      .onConflictDoUpdate({
        set: {
          passwordHash,
          updatedAt: seededAt,
        },
        target: passwordCredentials.accountId,
      })
      .run()

    tx.insert(toolProfiles)
      .values({
        accountId: seedInput.accountId,
        createdAt: seededAt,
        id: assistantToolProfileId,
        name: 'Assistant Default',
        scope: 'account_private',
        status: 'active',
        tenantId: seedInput.tenantId,
        updatedAt: seededAt,
      })
      .onConflictDoUpdate({
        set: {
          accountId: seedInput.accountId,
          name: 'Assistant Default',
          scope: 'account_private',
          status: 'active',
          updatedAt: seededAt,
        },
        target: toolProfiles.id,
      })
      .run()

    const defaultAgentId = seedInput.seedGarden ? createAliceAgentId(seedInput.accountId) : null
    const defaultTargetKind = seedInput.seedGarden ? ('agent' as const) : ('assistant' as const)

    tx.insert(accountPreferences)
      .values({
        accountId: seedInput.accountId,
        assistantToolProfileId,
        defaultAgentId,
        defaultTargetKind,
        shortcutBindings: null,
        tenantId: seedInput.tenantId,
        updatedAt: seededAt,
      })
      .onConflictDoUpdate({
        set: {
          assistantToolProfileId,
          defaultAgentId,
          defaultTargetKind,
          shortcutBindings: null,
          updatedAt: seededAt,
        },
        target: [accountPreferences.tenantId, accountPreferences.accountId],
      })
      .run()

    if (seedInput.seedGarden) {
      const gardenSiteId = createPrefixedId('gst')

      tx.insert(gardenSites)
        .values({
          buildMode: 'debounced_scan',
          createdAt: seededAt,
          createdByAccountId: seedInput.accountId,
          currentBuildId: null,
          currentPublishedBuildId: null,
          deployMode: 'api_hosted',
          id: gardenSiteId,
          isDefault: true,
          name: 'Wonderlands',
          protectedAccessMode: 'none',
          protectedSecretRef: null,
          protectedSessionTtlSeconds: 86_400,
          slug: 'wonderlands',
          sourceScopePath: 'wonderlands',
          status: 'active',
          tenantId: seedInput.tenantId,
          updatedAt: seededAt,
          updatedByAccountId: seedInput.accountId,
        })
        .onConflictDoUpdate({
          set: {
            buildMode: 'debounced_scan',
            name: 'Wonderlands',
            sourceScopePath: 'wonderlands',
            status: 'active',
            updatedAt: seededAt,
            updatedByAccountId: seedInput.accountId,
          },
          target: gardenSites.id,
        })
        .run()

      const aliceAgentId = createAliceAgentId(seedInput.accountId)
      const aliceRevisionId = createAliceRevisionId(seedInput.accountId)
      const aiProvider = runtime.config.ai.defaults.provider
      const providerConfig = runtime.config.ai.providers[aiProvider]
      const aiModel = providerConfig?.defaultModel ?? runtime.config.ai.defaults.model
      const aliceSourceMarkdown = buildAliceSourceMarkdown(aiProvider, aiModel)
      const aliceChecksum = createHash('sha256').update(aliceSourceMarkdown).digest('hex')

      const aliceModelConfig = { provider: aiProvider, modelAlias: aiModel }
      const aliceSandboxPolicy = {
        enabled: true,
        network: { mode: 'open' },
        packages: { mode: 'disabled' },
        runtime: {
          allowAutomaticCompatFallback: false,
          allowedEngines: ['node'],
          allowWorkspaceScripts: false,
          defaultEngine: 'node',
          maxDurationSec: 120,
          maxInputBytes: 25_000_000,
          maxMemoryMb: 512,
          maxOutputBytes: 25_000_000,
          nodeVersion: '22',
        },
        vault: {
          mode: 'read_write',
          requireApprovalForDelete: true,
          requireApprovalForMove: true,
          requireApprovalForWorkspaceScript: true,
          requireApprovalForWrite: false,
        },
      }
      const aliceToolPolicy = {
        native: ['execute', 'commit_sandbox_writeback', 'web_search'],
      }
      const aliceGardenFocus = { preferredSlugs: ['wonderlands'] }
      const aliceKernelPolicy = {
        browser: {
          allowRecording: false,
          defaultViewport: { height: 900, width: 1440 },
          maxConcurrentSessions: 1,
          maxDurationSec: 60,
        },
        enabled: false,
        network: { allowedHosts: [], blockedHosts: [], mode: 'open' },
        outputs: {
          allowCookies: false,
          allowHtml: true,
          allowPdf: false,
          allowRecording: false,
          allowScreenshot: true,
          maxOutputBytes: 25_000_000,
        },
      }
      const aliceFrontmatter = {
        schema: 'agent/v1',
        name: 'Alice',
        description: 'Main agent for the workspace.',
        slug: 'alice',
        visibility: 'tenant_shared',
        kind: 'primary',
        model: { provider: aiProvider, model_alias: aiModel },
        garden: { preferred_slugs: ['wonderlands'] },
        tools: { native: ['web_search'] },
      }
      const aliceResolvedConfig = {
        garden: aliceGardenFocus,
        kernel: aliceKernelPolicy,
        memory: {},
        model: aliceModelConfig,
        sandbox: aliceSandboxPolicy,
        subagents: [],
        tools: aliceToolPolicy,
        workspace: { strategy: 'isolated_run' },
      }

      tx.insert(agents)
        .values({
          activeRevisionId: aliceRevisionId,
          archivedAt: null,
          baseAgentId: null,
          createdAt: seededAt,
          createdByAccountId: seedInput.accountId,
          id: aliceAgentId,
          kind: 'primary',
          name: 'Alice',
          ownerAccountId: seedInput.accountId,
          slug: 'alice',
          status: 'active',
          tenantId: seedInput.tenantId,
          updatedAt: seededAt,
          visibility: 'tenant_shared',
        })
        .onConflictDoUpdate({
          set: {
            activeRevisionId: aliceRevisionId,
            name: 'Alice',
            status: 'active',
            updatedAt: seededAt,
          },
          target: agents.id,
        })
        .run()

      tx.insert(agentRevisions)
        .values({
          agentId: aliceAgentId,
          checksumSha256: aliceChecksum,
          createdAt: seededAt,
          createdByAccountId: seedInput.accountId,
          frontmatterJson: aliceFrontmatter,
          gardenFocusJson: aliceGardenFocus,
          id: aliceRevisionId,
          instructionsMd: "You're Alice.",
          kernelPolicyJson: aliceKernelPolicy,
          memoryPolicyJson: {},
          modelConfigJson: aliceModelConfig,
          resolvedConfigJson: aliceResolvedConfig,
          sandboxPolicyJson: aliceSandboxPolicy,
          sourceMarkdown: aliceSourceMarkdown,
          tenantId: seedInput.tenantId,
          toolPolicyJson: aliceToolPolicy,
          toolProfileId: null,
          version: 1,
          workspacePolicyJson: {},
        })
        .onConflictDoUpdate({
          set: {
            checksumSha256: aliceChecksum,
            frontmatterJson: aliceFrontmatter,
            gardenFocusJson: aliceGardenFocus,
            instructionsMd: "You're Alice.",
            kernelPolicyJson: aliceKernelPolicy,
            modelConfigJson: aliceModelConfig,
            resolvedConfigJson: aliceResolvedConfig,
            sandboxPolicyJson: aliceSandboxPolicy,
            sourceMarkdown: aliceSourceMarkdown,
            toolPolicyJson: aliceToolPolicy,
            workspacePolicyJson: {},
          },
          target: agentRevisions.id,
        })
        .run()
    }
  })

  if (seedInput.seedGarden) {
    const fileStorageRoot = runtime.config.files.storage.root
    const workspacesRoot = resolve(fileStorageRoot, '..', 'workspaces')
    const vaultRoot = join(
      workspacesRoot,
      `ten_${seedInput.tenantId}`,
      `acc_${seedInput.accountId}`,
      'vault',
      'wonderlands',
    )

    mkdirSync(vaultRoot, { recursive: true })

    const gardenYmlPath = join(vaultRoot, '_garden.yml')
    const indexMdPath = join(vaultRoot, 'index.md')

    if (!existsSync(gardenYmlPath)) {
      writeFileSync(gardenYmlPath, defaultGardenYml, 'utf8')
    }

    if (!existsSync(indexMdPath)) {
      writeFileSync(indexMdPath, defaultGardenIndexMd, 'utf8')
    }
  }

  return {
    accountEmail: seedInput.accountEmail,
    accountId: seedInput.accountId,
    accountPassword: password,
    apiKeyId: seedInput.apiKeyId,
    apiKeySecret,
    manifestPath,
    secretSource,
    tenantId: seedInput.tenantId,
    tenantRole: seedInput.tenantRole,
  }
}
