import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createAgentRepository } from '../src/adapters/persistence/sqlite/agents/agent-repository'
import {
  parseAgentMarkdown,
  serializeAgentMarkdown,
} from '../src/application/agents/agent-markdown'
import { createAgentSyncService } from '../src/application/agents/agent-sync-service'
import { accounts, agents, domainEvents, tenants } from '../src/db/schema'
import { asAccountId, asAgentId, asTenantId } from '../src/shared/ids'
import type { TenantScope } from '../src/shared/scope'
import { createTestHarness } from './helpers/create-test-app'

const testNow = '2026-03-30T04:30:00.000Z'

const createScope = (): TenantScope => ({
  accountId: asAccountId('acc_test'),
  tenantId: asTenantId('ten_test'),
})

const createIdFactory = (...ids: string[]) => {
  let index = 0

  return (_prefix: string): string => {
    const next = ids[index]

    if (!next) {
      throw new Error(`missing test id at index ${index}`)
    }

    index += 1

    return next
  }
}

const seedTenantAccount = (runtime: ReturnType<typeof createTestHarness>['runtime']) => {
  runtime.db
    .insert(tenants)
    .values({
      createdAt: testNow,
      id: 'ten_test',
      name: 'Tenant',
      slug: 'tenant',
      status: 'active',
      updatedAt: testNow,
    })
    .run()

  runtime.db
    .insert(accounts)
    .values({
      createdAt: testNow,
      email: 'acc_test@example.com',
      id: 'acc_test',
      name: 'Account',
      preferences: null,
      updatedAt: testNow,
    })
    .run()
}

const baseMarkdown = `---
schema: agent/v1
name: Alpha
description: Coordinates planning and execution work.
slug: alpha
visibility: account_private
kind: primary
model:
  provider: openai
  model_alias: gpt-5.4
  reasoning:
    effort: medium
tools:
  native:
    - suspend_run
  tool_profile_id: tpf_default
memory:
  profile_scope: true
  child_promotion: explicit
workspace:
  strategy: isolated_run
---
You are Alpha.

Plan clearly.
`

test('agent markdown round-trips through gray-matter and zod', () => {
  const parsed = parseAgentMarkdown(baseMarkdown)

  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.frontmatter.description, 'Coordinates planning and execution work.')

  const serialized = serializeAgentMarkdown(parsed.value)
  const reparsed = parseAgentMarkdown(serialized)

  assert.equal(reparsed.ok, true)
  assert.deepEqual(reparsed.value, parsed.value)
})

test('agent markdown preserves MCP mode in tools frontmatter', () => {
  const document = {
    frontmatter: {
      kind: 'specialist' as const,
      name: 'Code Mode Agent',
      schema: 'agent/v1' as const,
      slug: 'code-mode-agent',
      tools: {
        mcpMode: 'code' as const,
        native: ['delegate_to_agent'],
        toolProfileId: 'tpf_code_mode',
      },
      visibility: 'account_private' as const,
    },
    instructionsMd: 'Use MCP through code.',
  }

  const serialized = serializeAgentMarkdown(document)
  const reparsed = parseAgentMarkdown(serialized)

  assert.equal(reparsed.ok, true)
  if (!reparsed.ok) {
    throw new Error('expected markdown to parse after serialization')
  }

  assert.equal(reparsed.value.frontmatter.tools?.mcpMode, 'code')
  assert.deepEqual(reparsed.value.frontmatter.tools?.native, ['delegate_to_agent'])
  assert.equal(reparsed.value.frontmatter.tools?.toolProfileId, 'tpf_code_mode')
})

test('agent markdown preserves sandbox engine, package runtime, and shell policy metadata', () => {
  const document = {
    frontmatter: {
      kind: 'specialist' as const,
      name: 'Sandbox Planner',
      sandbox: {
        enabled: true,
        network: {
          allowedHosts: ['registry.npmjs.org'],
          mode: 'allow_list' as const,
        },
        packages: {
          allowedPackages: [
            {
              allowInstallScripts: false,
              name: 'csv-parse',
              runtimes: ['lo', 'node'] as const,
              versionRange: '5.6.0',
            },
          ],
          mode: 'allow_list' as const,
        },
        runtime: {
          allowAutomaticCompatFallback: true,
          allowedEngines: ['lo', 'node'] as const,
          allowWorkspaceScripts: true,
          defaultEngine: 'lo' as const,
          maxDurationSec: 180,
          maxInputBytes: 12_000_000,
          maxMemoryMb: 768,
          maxOutputBytes: 18_000_000,
          nodeVersion: '22',
        },
        shell: {
          allowedCommands: ['find', 'grep', 'mv'],
        },
        vault: {
          allowedRoots: ['/vault/project'],
          mode: 'read_write' as const,
        },
      },
      schema: 'agent/v1' as const,
      slug: 'sandbox-planner',
      visibility: 'account_private' as const,
    },
    instructionsMd: 'Use the safe sandbox first.',
  }

  const serialized = serializeAgentMarkdown(document)
  const reparsed = parseAgentMarkdown(serialized)

  assert.equal(reparsed.ok, true)
  if (!reparsed.ok) {
    throw new Error('expected markdown to parse after serialization')
  }

  assert.equal(reparsed.value.frontmatter.kind, document.frontmatter.kind)
  assert.equal(reparsed.value.frontmatter.name, document.frontmatter.name)
  assert.equal(reparsed.value.frontmatter.slug, document.frontmatter.slug)
  assert.equal(reparsed.value.frontmatter.visibility, document.frontmatter.visibility)
  assert.deepEqual(
    reparsed.value.frontmatter.sandbox?.network,
    document.frontmatter.sandbox?.network,
  )
  assert.deepEqual(
    reparsed.value.frontmatter.sandbox?.packages?.allowedPackages,
    document.frontmatter.sandbox?.packages?.allowedPackages,
  )
  assert.deepEqual(
    reparsed.value.frontmatter.sandbox?.runtime,
    document.frontmatter.sandbox?.runtime,
  )
  assert.deepEqual(reparsed.value.frontmatter.sandbox?.shell, document.frontmatter.sandbox?.shell)
  assert.deepEqual(
    reparsed.value.frontmatter.sandbox?.vault?.allowedRoots,
    document.frontmatter.sandbox?.vault?.allowedRoots,
  )
  assert.equal(
    reparsed.value.frontmatter.sandbox?.vault?.mode,
    document.frontmatter.sandbox?.vault?.mode,
  )
  assert.equal(reparsed.value.instructionsMd, document.instructionsMd)
})

test('agent sync import creates and updates immutable revisions', async () => {
  {
    const { runtime } = createTestHarness()

    seedTenantAccount(runtime)

    const service = createAgentSyncService({
      createId: createIdFactory('agt_alpha', 'agr_alpha_v1'),
      db: runtime.db,
      now: () => testNow,
    })

    const imported = service.importMarkdown(createScope(), {
      markdown: baseMarkdown,
    })

    assert.equal(imported.ok, true)
    assert.equal(imported.value.created, true)
    assert.equal(imported.value.agent.id, 'agt_alpha')
    assert.equal(imported.value.agent.activeRevisionId, 'agr_alpha_v1')
    assert.equal(imported.value.revision.version, 1)
    assert.deepEqual(
      runtime.db
        .select()
        .from(domainEvents)
        .all()
        .slice()
        .sort((left, right) => left.eventNo - right.eventNo)
        .map((event) => event.type),
      ['agent.created', 'agent.revision.created'],
    )

    const exported = service.exportMarkdown(createScope(), {
      agentId: imported.value.agent.id,
    })

    assert.equal(exported.ok, true)
    assert.equal(exported.value.markdown, imported.value.markdown)
  }

  {
    const { runtime } = createTestHarness()

    seedTenantAccount(runtime)

    const service = createAgentSyncService({
      createId: createIdFactory(
        'agt_alpha',
        'agr_alpha_v1',
        'agr_alpha_v2',
        'agt_missing',
        'agr_missing',
      ),
      db: runtime.db,
      now: () => testNow,
    })

    const created = service.importMarkdown(createScope(), {
      markdown: baseMarkdown,
    })

    assert.equal(created.ok, true)

    const parsedCreated = parseAgentMarkdown(created.value.markdown)

    assert.equal(parsedCreated.ok, true)

    const updatedMarkdown = serializeAgentMarkdown({
      ...parsedCreated.value,
      frontmatter: {
        ...parsedCreated.value.frontmatter,
        name: 'Bravo',
        slug: 'bravo',
      },
      instructionsMd: 'You are Bravo.\n\nWrite directly.',
    })

    const updated = service.importMarkdown(createScope(), {
      markdown: updatedMarkdown,
    })

    assert.equal(updated.ok, true)
    assert.equal(updated.value.created, false)
    assert.equal(updated.value.agent.slug, 'bravo')
    assert.equal(updated.value.agent.name, 'Bravo')
    assert.equal(updated.value.revision.id, 'agr_alpha_v2')
    assert.equal(updated.value.revision.version, 2)

    const exported = service.exportMarkdown(createScope(), {
      agentId: updated.value.agent.id,
    })

    assert.equal(exported.ok, true)

    const parsedExport = parseAgentMarkdown(exported.value.markdown)

    assert.equal(parsedExport.ok, true)
    assert.equal(
      parsedExport.value.frontmatter.description,
      'Coordinates planning and execution work.',
    )
    assert.equal(parsedExport.value.frontmatter.name, 'Bravo')
    assert.equal(parsedExport.value.frontmatter.slug, 'bravo')
    assert.equal(parsedExport.value.frontmatter.revisionId, 'agr_alpha_v2')
    assert.equal(parsedExport.value.instructionsMd, 'You are Bravo.\n\nWrite directly.')
  }
})
test('agent sync import rejects stale revision ids and invalid child-agent references', () => {
  const { runtime } = createTestHarness()

  seedTenantAccount(runtime)

  const service = createAgentSyncService({
    createId: createIdFactory(
      'agt_alpha',
      'agr_alpha_v1',
      'agr_alpha_v2',
      'agt_missing',
      'agr_missing',
    ),
    db: runtime.db,
    now: () => testNow,
  })

  const created = service.importMarkdown(createScope(), {
    markdown: baseMarkdown,
  })

  assert.equal(created.ok, true)

  const parsedCreated = parseAgentMarkdown(created.value.markdown)

  assert.equal(parsedCreated.ok, true)

  const updated = service.importMarkdown(createScope(), {
    markdown: serializeAgentMarkdown({
      ...parsedCreated.value,
      instructionsMd: 'You are Alpha.\n\nSecond revision.',
    }),
  })

  assert.equal(updated.ok, true)
  const eventCountBeforeStaleImport = runtime.db.select().from(domainEvents).all().length

  const stale = service.importMarkdown(createScope(), {
    markdown: created.value.markdown,
  })

  assert.equal(stale.ok, false)
  assert.equal(stale.error.type, 'conflict')
  assert.match(stale.error.message, /is at revision agr_alpha_v2/)
  assert.equal(runtime.db.select().from(domainEvents).all().length, eventCountBeforeStaleImport)

  const missingChild = service.importMarkdown(createScope(), {
    markdown: `${baseMarkdown
      .replace('slug: alpha\n', 'slug: alpha-missing-child\n')
      .replace(
        'workspace:\n  strategy: isolated_run\n',
        'workspace:\n  strategy: isolated_run\nsubagents:\n  - slug: missing-child\n    alias: researcher\n    mode: async_join\n',
      )}`,
  })

  assert.equal(missingChild.ok, false)
  assert.equal(missingChild.error.type, 'validation')
  assert.match(missingChild.error.message, /subagent slug "missing-child"/)
})

test('agent sync derives sandbox and browser grants from runtime policy', async () => {
  {
    const { runtime } = createTestHarness()

    seedTenantAccount(runtime)

    const service = createAgentSyncService({
      createId: createIdFactory('agt_alpha', 'agr_alpha_v1'),
      db: runtime.db,
      now: () => testNow,
    })

    const result = service.importMarkdown(createScope(), {
      markdown: `${baseMarkdown.replace(
        'tools:\n  native:\n    - suspend_run\n  tool_profile_id: tpf_default\n',
        'tools:\n  native:\n    - suspend_run\n  tool_profile_id: tpf_default\nsandbox:\n  enabled: true\n  vault:\n    mode: read_write\n    allowed_roots:\n      - /vault/overment\n',
      )}`,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.value.revision.toolPolicyJson, {
      native: ['suspend_run', 'execute', 'commit_sandbox_writeback'],
    })
    assert.deepEqual(result.value.revision.resolvedConfigJson.tools, {
      native: ['suspend_run', 'execute', 'commit_sandbox_writeback'],
    })
  }

  {
    const { runtime } = createTestHarness()

    seedTenantAccount(runtime)

    const service = createAgentSyncService({
      createId: createIdFactory('agt_alpha', 'agr_alpha_v1'),
      db: runtime.db,
      now: () => testNow,
    })

    const result = service.importMarkdown(createScope(), {
      markdown: `${baseMarkdown.replace(
        'tools:\n  native:\n    - suspend_run\n  tool_profile_id: tpf_default\n',
        'tools:\n  native:\n    - suspend_run\n  tool_profile_id: tpf_default\nsandbox:\n  enabled: true\n  runtime:\n    default_engine: lo\n    allowed_engines:\n      - lo\n  vault:\n    mode: read_write\n    allowed_roots:\n      - /vault/overment\n',
      )}`,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.value.revision.toolPolicyJson, {
      native: ['suspend_run', 'execute', 'commit_sandbox_writeback'],
    })
    assert.deepEqual(result.value.revision.resolvedConfigJson.tools, {
      native: ['suspend_run', 'execute', 'commit_sandbox_writeback'],
    })
  }

  {
    const { runtime } = createTestHarness()

    seedTenantAccount(runtime)

    const service = createAgentSyncService({
      createId: createIdFactory('agt_alpha', 'agr_alpha_v1'),
      db: runtime.db,
      now: () => testNow,
    })

    const result = service.importMarkdown(createScope(), {
      markdown: `${baseMarkdown.replace(
        '  native:\n    - suspend_run\n',
        '  native:\n    - suspend_run\n    - execute\n    - commit_sandbox_writeback\n',
      )}`,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.value.revision.toolPolicyJson, {
      native: ['suspend_run'],
    })
  }

  {
    const { runtime } = createTestHarness()

    seedTenantAccount(runtime)

    const service = createAgentSyncService({
      createId: createIdFactory('agt_alpha', 'agr_alpha_v1'),
      db: runtime.db,
      now: () => testNow,
    })

    const result = service.importMarkdown(createScope(), {
      markdown: `${baseMarkdown.replace(
        'memory:\n  profile_scope: true\n  child_promotion: explicit\n',
        'kernel:\n  enabled: true\n  browser:\n    max_duration_sec: 90\n  outputs:\n    allow_pdf: true\nmemory:\n  profile_scope: true\n  child_promotion: explicit\n',
      )}`,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.value.revision.toolPolicyJson, {
      native: ['suspend_run', 'browse'],
    })
    assert.deepEqual(result.value.revision.resolvedConfigJson.tools, {
      native: ['suspend_run', 'browse'],
    })
    assert.equal((result.value.revision.kernelPolicyJson as { enabled: boolean }).enabled, true)
    assert.equal(
      (
        result.value.revision.kernelPolicyJson as {
          browser: { maxDurationSec: number }
        }
      ).browser.maxDurationSec,
      90,
    )
    assert.equal(
      (
        result.value.revision.resolvedConfigJson.kernel as {
          outputs: { allowPdf: boolean }
        }
      ).outputs.allowPdf,
      true,
    )
  }

  {
    const { runtime } = createTestHarness()

    seedTenantAccount(runtime)

    const service = createAgentSyncService({
      createId: createIdFactory('agt_alpha', 'agr_alpha_v1'),
      db: runtime.db,
      now: () => testNow,
    })

    const result = service.importMarkdown(createScope(), {
      markdown: `${baseMarkdown.replace(
        '  native:\n    - suspend_run\n',
        '  native:\n    - suspend_run\n    - browse\n',
      )}`,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.value.revision.toolPolicyJson, {
      native: ['suspend_run'],
    })
  }
})
test('agent sync import resolves declared subagent links by slug', () => {
  const { runtime } = createTestHarness()

  seedTenantAccount(runtime)

  const scope = createScope()
  const agentRepository = createAgentRepository(runtime.db)
  const childCreated = agentRepository.create(scope, {
    createdAt: testNow,
    createdByAccountId: scope.accountId,
    id: asAgentId('agt_child'),
    kind: 'specialist',
    name: 'Researcher',
    ownerAccountId: scope.accountId,
    slug: 'researcher',
    status: 'active',
    updatedAt: testNow,
    visibility: 'account_private',
  })

  assert.equal(childCreated.ok, true)

  const service = createAgentSyncService({
    createId: createIdFactory('agt_alpha', 'agr_alpha_v1', 'asl_link_1'),
    db: runtime.db,
    now: () => testNow,
  })

  const result = service.importMarkdown(scope, {
    markdown: `${baseMarkdown.replace(
      'workspace:\n  strategy: isolated_run\n',
      'workspace:\n  strategy: isolated_run\nsubagents:\n  - slug: researcher\n    alias: researcher\n    mode: async_join\n',
    )}`,
  })

  assert.equal(result.ok, true)
  assert.equal(result.value.subagentLinks.length, 1)
  assert.equal(result.value.subagentLinks[0]?.childAgentId, childCreated.value.id)
  assert.equal(result.value.subagentLinks[0]?.alias, 'researcher')
})

test('agent sync import resolves subagent slugs against the live agent when a deleted slug tombstone exists', () => {
  const { runtime } = createTestHarness()

  seedTenantAccount(runtime)

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: null,
      archivedAt: testNow,
      baseAgentId: null,
      createdAt: '2026-03-30T04:00:00.000Z',
      createdByAccountId: 'acc_test',
      id: 'agt_child_deleted',
      kind: 'specialist',
      name: 'Researcher',
      ownerAccountId: 'acc_test',
      slug: 'researcher',
      status: 'deleted',
      tenantId: 'ten_test',
      updatedAt: testNow,
      visibility: 'account_private',
    })
    .run()

  const scope = createScope()
  const agentRepository = createAgentRepository(runtime.db)
  const childCreated = agentRepository.create(scope, {
    createdAt: testNow,
    createdByAccountId: scope.accountId,
    id: asAgentId('agt_child_active'),
    kind: 'specialist',
    name: 'Researcher',
    ownerAccountId: scope.accountId,
    slug: 'researcher',
    status: 'active',
    updatedAt: testNow,
    visibility: 'account_private',
  })

  assert.equal(childCreated.ok, true)

  const service = createAgentSyncService({
    createId: createIdFactory('agt_alpha', 'agr_alpha_v1', 'asl_link_1'),
    db: runtime.db,
    now: () => testNow,
  })

  const result = service.importMarkdown(scope, {
    markdown: `${baseMarkdown.replace(
      'workspace:\n  strategy: isolated_run\n',
      'workspace:\n  strategy: isolated_run\nsubagents:\n  - slug: researcher\n    alias: researcher\n    mode: async_join\n',
    )}`,
  })

  assert.equal(result.ok, true)
  assert.equal(result.value.subagentLinks.length, 1)
  assert.equal(result.value.subagentLinks[0]?.childAgentId, childCreated.value.id)
})
