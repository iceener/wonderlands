import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  hasNativeToolGrant,
  resolveMcpModeForRun,
} from '../src/application/agents/agent-runtime-policy'
import { agentRevisions, agents } from '../src/db/schema'
import { asAgentRevisionId, asTenantId } from '../src/shared/ids'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

test('hasNativeToolGrant treats legacy get_tool grants as aliases for get_tools', () => {
  assert.equal(
    hasNativeToolGrant(
      {
        toolPolicyJson: {
          native: ['search_tools', 'get_tool', 'execute'],
        },
      },
      'get_tools',
    ),
    true,
  )
})

test('resolveMcpModeForRun allows code mode for lo-only sandbox agents', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, assistantToolProfileId, tenantId } = seedApiKeyAuth(runtime)
  const createdAt = '2026-04-07T10:00:00.000Z'
  const agentId = 'agt_lo_code_mode'
  const revisionId = asAgentRevisionId('agr_lo_code_mode_v1')

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: revisionId,
      archivedAt: null,
      baseAgentId: null,
      createdAt,
      createdByAccountId: accountId,
      id: agentId,
      kind: 'specialist',
      name: 'lo code mode',
      ownerAccountId: accountId,
      slug: 'lo-code-mode',
      status: 'active',
      tenantId,
      updatedAt: createdAt,
      visibility: 'account_private',
    })
    .run()

  runtime.db
    .insert(agentRevisions)
    .values({
      agentId,
      checksumSha256: 'checksum',
      createdAt,
      createdByAccountId: accountId,
      frontmatterJson: {},
      gardenFocusJson: {},
      id: revisionId,
      instructionsMd: 'Use MCP code mode.',
      kernelPolicyJson: {},
      memoryPolicyJson: {},
      modelConfigJson: {},
      resolvedConfigJson: {},
      sandboxPolicyJson: {
        enabled: true,
        network: {
          mode: 'off',
        },
        packages: {
          allowedRegistries: [],
          mode: 'allow_list',
        },
        runtime: {
          allowAutomaticCompatFallback: false,
          allowWorkspaceScripts: true,
          allowedEngines: ['lo'],
          defaultEngine: 'lo',
          maxDurationSec: 120,
          maxInputBytes: 25_000_000,
          maxMemoryMb: 512,
          maxOutputBytes: 25_000_000,
          nodeVersion: '22',
        },
        vault: {
          allowedRoots: [],
          mode: 'none',
        },
      },
      sourceMarkdown: '',
      tenantId,
      toolPolicyJson: {
        mcpMode: 'code',
        native: ['search_tools', 'get_tools', 'execute'],
      },
      toolProfileId: assistantToolProfileId,
      version: 1,
      workspacePolicyJson: {},
    })
    .run()

  assert.equal(
    resolveMcpModeForRun(
      runtime.db,
      {
        accountId,
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      {
        agentRevisionId: revisionId,
      },
    ),
    'code',
  )
})
