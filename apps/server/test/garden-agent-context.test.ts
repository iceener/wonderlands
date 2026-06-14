import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  formatGardenContextDeveloperMessage,
  getAssignedGardenSites,
  loadGardenAgentContext,
} from '../src/application/garden/garden-agent-context'
import { toToolContext } from '../src/application/runtime/execution/run-tool-execution'
import { accounts, agentRevisions, agents, gardenSites } from '../src/db/schema'
import {
  asAgentId,
  asAgentRevisionId,
  asGardenSiteId,
  asRequestId,
  asRunId,
  asSessionThreadId,
  asTenantId,
  asTraceId,
  asWorkSessionId,
} from '../src/shared/ids'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const now = '2026-04-04T10:00:00.000Z'

const seedAgentRevision = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    nativeTools?: string[]
    revisionId: string
    sandboxPolicyJson?: Record<string, unknown>
    slug: string
    tenantId: string
  },
) => {
  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: input.revisionId,
      archivedAt: null,
      baseAgentId: null,
      createdAt: now,
      createdByAccountId: input.accountId,
      id: 'agt_test',
      kind: 'primary',
      name: 'Test Agent',
      ownerAccountId: input.accountId,
      slug: input.slug,
      status: 'active',
      tenantId: input.tenantId,
      updatedAt: now,
      visibility: 'account_private',
    })
    .run()

  runtime.db
    .insert(agentRevisions)
    .values({
      agentId: 'agt_test',
      checksumSha256: `${input.revisionId}_checksum`,
      createdAt: now,
      createdByAccountId: input.accountId,
      frontmatterJson: {},
      gardenFocusJson: { preferredSlugs: ['demo'] },
      id: input.revisionId,
      instructionsMd: 'Keep answers direct.',
      kernelPolicyJson: {},
      memoryPolicyJson: {},
      modelConfigJson: {},
      resolvedConfigJson: {},
      sourceMarkdown: '---\nname: Test Agent\n---\nKeep answers direct.',
      tenantId: input.tenantId,
      toolPolicyJson: { native: input.nativeTools ?? [] },
      version: 1,
      sandboxPolicyJson: input.sandboxPolicyJson ?? {},
      workspacePolicyJson: {},
    })
    .run()
}

const seedGardenSite = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    id: string
    isDefault?: boolean
    slug: string
    sourceScopePath: string
    status: 'active' | 'archived' | 'disabled' | 'draft'
    tenantId: string
  },
) => {
  runtime.db
    .insert(gardenSites)
    .values({
      buildMode: 'manual',
      createdAt: now,
      createdByAccountId: input.accountId,
      currentBuildId: null,
      currentPublishedBuildId: null,
      deployMode: 'api_hosted',
      id: input.id,
      isDefault: input.isDefault ?? false,
      name: input.slug,
      protectedAccessMode: 'none',
      protectedSecretRef: null,
      protectedSessionTtlSeconds: 3600,
      slug: input.slug,
      sourceScopePath: input.sourceScopePath,
      status: input.status,
      tenantId: input.tenantId,
      updatedAt: now,
      updatedByAccountId: input.accountId,
    })
    .run()
}

test('loadGardenAgentContext orders preferred gardens first and filters to the current account workspace', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)

  runtime.db
    .insert(accounts)
    .values({
      createdAt: now,
      email: 'other@example.com',
      id: 'acc_other',
      name: 'Other',
      preferences: null,
      updatedAt: now,
    })
    .run()

  seedAgentRevision(runtime, {
    accountId,
    revisionId: 'agr_test',
    slug: 'test-agent',
    tenantId,
  })
  seedGardenSite(runtime, {
    accountId,
    id: 'gst_overment',
    isDefault: true,
    slug: 'overment',
    sourceScopePath: 'overment',
    status: 'active',
    tenantId,
  })
  seedGardenSite(runtime, {
    accountId,
    id: 'gst_demo',
    slug: 'demo',
    sourceScopePath: '.',
    status: 'draft',
    tenantId,
  })
  seedGardenSite(runtime, {
    accountId: 'acc_other',
    id: 'gst_hidden',
    slug: 'hidden',
    sourceScopePath: 'hidden',
    status: 'active',
    tenantId,
  })

  const result = loadGardenAgentContext(
    runtime.db,
    { accountId, role: 'admin', tenantId: asTenantId(tenantId) },
    asAgentRevisionId('agr_test'),
  )

  assert.equal(result.ok, true)
  assert.deepEqual(
    result.value.gardens.map((garden) => garden.slug),
    ['demo', 'overment'],
  )
  assert.equal(result.value.gardens[0]?.sourceRoot, '/vault')
  assert.equal(result.value.gardens[0]?.configPath, '/vault/_garden.yml')
  assert.equal(result.value.gardens[0]?.frontmatterReferencePath, '/vault/_meta/frontmatter.md')
  assert.equal(result.value.gardens[0]?.publicPath, '/vault/public')
  assert.equal(result.value.gardens[0]?.preferred, true)
  assert.equal(result.value.recommendedGarden?.slug, 'demo')
  assert.deepEqual(result.value.sandbox, {
    enabled: false,
    vaultMode: 'none',
  })
})

test('getAssignedGardenSites falls back to all reachable gardens when no preferred slugs are set', () => {
  const assigned = getAssignedGardenSites({
    gardens: [
      {
        configPath: '/vault/demo/_garden.yml',
        frontmatterReferencePath: '/vault/demo/_meta/frontmatter.md',
        id: asGardenSiteId('gst_demo'),
        isDefault: true,
        name: 'Demo',
        preferred: false,
        protectedAccessMode: 'none',
        publicPath: '/vault/demo/public',
        slug: 'demo',
        sourceRoot: '/vault/demo',
        sourceScopePath: 'demo',
        status: 'active',
      },
      {
        configPath: '/vault/overment/_garden.yml',
        frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
        id: asGardenSiteId('gst_overment'),
        isDefault: false,
        name: 'Overment',
        preferred: false,
        protectedAccessMode: 'none',
        publicPath: '/vault/overment/public',
        slug: 'overment',
        sourceRoot: '/vault/overment',
        sourceScopePath: 'overment',
        status: 'active',
      },
    ],
    preferredSlugs: [],
  })

  assert.deepEqual(
    assigned.map((garden) => garden.slug),
    ['demo', 'overment'],
  )
})

test('registered get_garden_context tool returns structured garden context for the current run', async () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)

  seedAgentRevision(runtime, {
    accountId,
    nativeTools: ['get_garden_context'],
    revisionId: 'agr_test',
    sandboxPolicyJson: {
      enabled: true,
      network: { mode: 'off' },
      packages: { mode: 'disabled' },
      runtime: {
        allowWorkspaceScripts: false,
        maxDurationSec: 120,
        maxInputBytes: 25_000_000,
        maxMemoryMb: 512,
        maxOutputBytes: 25_000_000,
        nodeVersion: '22',
      },
      vault: { mode: 'read_only' },
    },
    slug: 'test-agent',
    tenantId,
  })
  seedGardenSite(runtime, {
    accountId,
    id: 'gst_demo',
    slug: 'demo',
    sourceScopePath: 'demo',
    status: 'active',
    tenantId,
  })

  const tool = runtime.services.tools.get('get_garden_context')

  assert.ok(tool)

  const run = {
    agentId: asAgentId('agt_test'),
    agentRevisionId: asAgentRevisionId('agr_test'),
    completedAt: null,
    configSnapshot: {},
    createdAt: now,
    errorJson: null,
    id: asRunId('run_test'),
    jobId: null,
    lastProgressAt: null,
    parentRunId: null,
    resultJson: null,
    rootRunId: asRunId('run_test'),
    sessionId: asWorkSessionId('ses_test'),
    sourceCallId: null,
    startedAt: now,
    status: 'running' as const,
    task: 'Describe the current gardens',
    tenantId: asTenantId(tenantId),
    threadId: asSessionThreadId('thr_test'),
    toolProfileId: null,
    turnCount: 0,
    updatedAt: now,
    version: 1,
    workspaceId: null,
    workspaceRef: null,
  }
  const toolContext = toToolContext(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_test'),
      services: runtime.services,
      tenantScope: {
        accountId,
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_test'),
    },
    run,
  )

  assert.equal(tool.isAvailable?.(toolContext), true)

  const executed = await tool.execute(toolContext, {})

  assert.equal(executed.ok, true)
  assert.equal(executed.value.kind, 'immediate')
  const output =
    executed.value.kind === 'immediate'
      ? (executed.value.output as {
          accountVaultRoot: string
          gardens: Array<{ frontmatterReferencePath: string; slug: string; sourceRoot: string }>
          recommendedGarden: { slug: string } | null
          sandbox: { enabled: boolean; vaultMode: string }
        })
      : null

  assert.equal(output?.accountVaultRoot, '/vault')
  assert.deepEqual(
    output?.gardens.map((garden) => garden.slug),
    ['demo'],
  )
  assert.equal(output?.gardens[0]?.sourceRoot, '/vault/demo')
  assert.equal(output?.gardens[0]?.frontmatterReferencePath, '/vault/demo/_meta/frontmatter.md')
  assert.equal(output?.recommendedGarden?.slug, 'demo')
  assert.deepEqual(output?.sandbox, {
    enabled: true,
    vaultMode: 'read_only',
  })
})

test('registered execute tool is available when the run has the grant', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)

  seedAgentRevision(runtime, {
    accountId,
    nativeTools: ['execute'],
    revisionId: 'agr_test',
    sandboxPolicyJson: {
      enabled: true,
      vault: { mode: 'read_only' },
    },
    slug: 'test-agent',
    tenantId,
  })

  const tool = runtime.services.tools.get('execute')

  assert.ok(tool)

  const run = {
    agentId: asAgentId('agt_test'),
    agentRevisionId: asAgentRevisionId('agr_test'),
    completedAt: null,
    configSnapshot: {},
    createdAt: now,
    errorJson: null,
    id: asRunId('run_test'),
    jobId: null,
    lastProgressAt: null,
    parentRunId: null,
    resultJson: null,
    rootRunId: asRunId('run_test'),
    sessionId: asWorkSessionId('ses_test'),
    sourceCallId: null,
    startedAt: now,
    status: 'running' as const,
    task: 'Inspect the garden',
    tenantId: asTenantId(tenantId),
    threadId: asSessionThreadId('thr_test'),
    toolProfileId: null,
    turnCount: 0,
    updatedAt: now,
    version: 1,
    workspaceId: null,
    workspaceRef: null,
  }
  const toolContext = toToolContext(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_test'),
      services: runtime.services,
      tenantScope: {
        accountId,
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_test'),
    },
    run,
  )

  assert.equal(tool.isAvailable?.(toolContext), true)
})

test('registered execute tool remains available without assigned gardens', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)

  seedAgentRevision(runtime, {
    accountId,
    nativeTools: ['execute'],
    revisionId: 'agr_test',
    sandboxPolicyJson: {
      enabled: true,
      vault: { mode: 'read_only' },
    },
    slug: 'test-agent',
    tenantId,
  })

  const tool = runtime.services.tools.get('execute')

  assert.ok(tool)

  const run = {
    agentId: asAgentId('agt_test'),
    agentRevisionId: asAgentRevisionId('agr_test'),
    completedAt: null,
    configSnapshot: {},
    createdAt: now,
    errorJson: null,
    id: asRunId('run_test'),
    jobId: null,
    lastProgressAt: null,
    parentRunId: null,
    resultJson: null,
    rootRunId: asRunId('run_test'),
    sessionId: asWorkSessionId('ses_test'),
    sourceCallId: null,
    startedAt: now,
    status: 'running' as const,
    task: 'Inspect the garden',
    tenantId: asTenantId(tenantId),
    threadId: asSessionThreadId('thr_test'),
    toolProfileId: null,
    turnCount: 0,
    updatedAt: now,
    version: 1,
    workspaceId: null,
    workspaceRef: null,
  }
  const toolContext = toToolContext(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_test'),
      services: runtime.services,
      tenantScope: {
        accountId,
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_test'),
    },
    run,
  )

  assert.equal(tool.isAvailable?.(toolContext), true)
})

test('formatGardenContextDeveloperMessage explains protected routes and unlock flow', () => {
  const message = formatGardenContextDeveloperMessage(
    {
      accountVaultRoot: '/vault',
      configFilename: '_garden.yml',
      gardens: [
        {
          configPath: '/vault/overment/_garden.yml',
          frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
          id: asGardenSiteId('gst_overment'),
          isDefault: false,
          name: 'Overment',
          preferred: true,
          protectedAccessMode: 'site_password',
          publicPath: '/vault/overment/public',
          slug: 'overment',
          sourceRoot: '/vault/overment',
          sourceScopePath: 'overment',
          status: 'active',
        },
      ],
      preferredSlugs: ['overment'],
      privateRoots: ['_meta', 'attachments', 'system'],
      publishableAssetsRoot: 'public',
      recommendedGarden: {
        configPath: '/vault/overment/_garden.yml',
        frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
        id: asGardenSiteId('gst_overment'),
        isDefault: false,
        name: 'Overment',
        preferred: true,
        protectedAccessMode: 'site_password',
        publicPath: '/vault/overment/public',
        slug: 'overment',
        sourceRoot: '/vault/overment',
        sourceScopePath: 'overment',
        status: 'active',
      },
      sandbox: {
        enabled: false,
        vaultMode: 'none',
      },
    },
    {
      includeSandboxHint: false,
      includeToolHint: false,
    },
  )

  assert.equal(message?.includes('Protected routes:'), true)
  assert.equal(
    message?.includes(
      'Garden is file-first editorial state. Treat `_garden.yml`, markdown files, and `public/**` assets in the selected source root as the source of truth, not a separate CMS/database view.',
    ),
    true,
  )
  assert.equal(
    message?.includes(
      'Each garden source root also keeps a private frontmatter reference at <garden-root>/_meta/frontmatter.md. Read it when you need the full page field list or example syntax.',
    ),
    true,
  )
  assert.equal(
    message?.includes(
      'In Garden markdown, embed publishable assets with /public/... or public/... paths, not guessed final site URLs.',
    ),
    true,
  )
  assert.equal(
    message?.includes(
      'visibility: protected still requires the page path to be included by _garden.yml publishing roots; visibility: private publishes no route at all.',
    ),
    true,
  )
  assert.equal(
    message?.includes(
      'Open the protected page at its normal route, then unlock it there. Default gardens use /page-path with /_auth/unlock. Non-default gardens use /<garden-slug>/page-path with /<garden-slug>/_auth/unlock.',
    ),
    true,
  )
  assert.equal(message?.includes('protected=site_password'), true)
})
