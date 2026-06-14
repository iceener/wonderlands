import { describe, expect, test } from 'vitest'
import type { BackendMcpServerTool } from '../services/api'
import {
  assignedToolNames,
  defaultAssignableToolNames,
  defaultRequiresConfirmation,
  getAutoRenamedLabel,
  hasToolSelectionChanges,
  isDuplicateMcpLabelConflict,
  serializeArgumentRows,
  serializeKeyValueRows,
} from './connect-form'

describe('connect form helpers', () => {
  test('serializes argument rows as argv entries', () => {
    expect(
      serializeArgumentRows([{ value: ' --inspect ' }, { value: '' }, { value: ' ./server.js ' }]),
    ).toEqual(['--inspect', './server.js'])
  })

  test('serializes key value rows and trims whitespace', () => {
    expect(
      serializeKeyValueRows(
        [
          { key: ' Authorization ', value: ' Bearer token ' },
          { key: 'X-Client', value: ' ui ' },
        ],
        'header',
      ),
    ).toEqual({
      Authorization: 'Bearer token',
      'X-Client': 'ui',
    })
  })

  test('rejects key value rows without a key', () => {
    expect(() => serializeKeyValueRows([{ key: '', value: 'token' }], 'header')).toThrow(
      'Each header row needs a key.',
    )
  })

  test('detects duplicate MCP label conflicts from the backend error text', () => {
    expect(
      isDuplicateMcpLabelConflict(
        'failed to create MCP server mcs_1: UNIQUE constraint failed: mcp_servers.tenant_id, mcp_servers.created_by_account_id, mcp_servers.label',
      ),
    ).toBe(true)
    expect(isDuplicateMcpLabelConflict('some other error')).toBe(false)
  })

  test('generates a readable fallback label suffix', () => {
    expect(getAutoRenamedLabel('Research MCP', 0)).toBe('Research MCP')
    expect(getAutoRenamedLabel('Research MCP', 1)).toBe('Research MCP 2')
    expect(getAutoRenamedLabel('Research MCP', 2)).toBe('Research MCP 3')
  })

  test('preselects unassigned model-visible tools only', () => {
    const tools: BackendMcpServerTool[] = [
      {
        appsMetaJson: null,
        assignment: null,
        createdAt: '2026-03-30T08:00:00.000Z',
        description: 'Echo text',
        executionJson: null,
        fingerprint: 'fp_1',
        id: 'mct_1',
        inputSchemaJson: {},
        isActive: true,
        modelVisible: true,
        outputSchemaJson: null,
        remoteName: 'echo',
        runtimeName: 'mcp__echo',
        serverId: 'mcs_1',
        tenantId: 'ten_overment',
        title: 'Echo',
        updatedAt: '2026-03-30T08:00:00.000Z',
      },
      {
        appsMetaJson: null,
        assignment: null,
        createdAt: '2026-03-30T08:00:00.000Z',
        description: 'App-only tool',
        executionJson: null,
        fingerprint: 'fp_2',
        id: 'mct_2',
        inputSchemaJson: {},
        isActive: true,
        modelVisible: false,
        outputSchemaJson: null,
        remoteName: 'app_only',
        runtimeName: 'mcp__app_only',
        serverId: 'mcs_1',
        tenantId: 'ten_overment',
        title: 'App Only',
        updatedAt: '2026-03-30T08:00:00.000Z',
      },
      {
        appsMetaJson: null,
        assignment: {
          approvedAt: null,
          approvedFingerprint: null,
          assignedAt: '2026-03-30T08:01:00.000Z',
          assignedByAccountId: 'acc_adam_overment',
          id: 'mta_1',
          toolProfileId: 'tpf_default',
          requiresConfirmation: true,
          runtimeName: 'mcp__assigned',
          serverId: 'mcs_1',
          tenantId: 'ten_overment',
          updatedAt: '2026-03-30T08:01:00.000Z',
        },
        createdAt: '2026-03-30T08:00:00.000Z',
        description: 'Already assigned',
        executionJson: null,
        fingerprint: 'fp_3',
        id: 'mct_3',
        inputSchemaJson: {},
        isActive: true,
        modelVisible: true,
        outputSchemaJson: null,
        remoteName: 'assigned',
        runtimeName: 'mcp__assigned',
        serverId: 'mcs_1',
        tenantId: 'ten_overment',
        title: 'Assigned',
        updatedAt: '2026-03-30T08:00:00.000Z',
      },
    ]

    expect(defaultAssignableToolNames(tools)).toEqual(['mcp__echo'])
    expect(assignedToolNames(tools)).toEqual(['mcp__assigned'])
    expect(defaultRequiresConfirmation(tools)).toBe(true)
  })

  test('detects tool assignment changes from checkbox state', () => {
    const tools: BackendMcpServerTool[] = [
      {
        appsMetaJson: null,
        assignment: {
          approvedAt: null,
          approvedFingerprint: null,
          assignedAt: '2026-03-30T08:01:00.000Z',
          assignedByAccountId: 'acc_adam_overment',
          id: 'mta_1',
          toolProfileId: 'tpf_default',
          requiresConfirmation: false,
          runtimeName: 'mcp__echo',
          serverId: 'mcs_1',
          tenantId: 'ten_overment',
          updatedAt: '2026-03-30T08:01:00.000Z',
        },
        createdAt: '2026-03-30T08:00:00.000Z',
        description: 'Echo text',
        executionJson: null,
        fingerprint: 'fp_1',
        id: 'mct_1',
        inputSchemaJson: {},
        isActive: true,
        modelVisible: true,
        outputSchemaJson: null,
        remoteName: 'echo',
        runtimeName: 'mcp__echo',
        serverId: 'mcs_1',
        tenantId: 'ten_overment',
        title: 'Echo',
        updatedAt: '2026-03-30T08:00:00.000Z',
      },
      {
        appsMetaJson: null,
        assignment: null,
        createdAt: '2026-03-30T08:00:00.000Z',
        description: 'Search',
        executionJson: null,
        fingerprint: 'fp_2',
        id: 'mct_2',
        inputSchemaJson: {},
        isActive: true,
        modelVisible: true,
        outputSchemaJson: null,
        remoteName: 'search',
        runtimeName: 'mcp__search',
        serverId: 'mcs_1',
        tenantId: 'ten_overment',
        title: 'Search',
        updatedAt: '2026-03-30T08:00:00.000Z',
      },
    ]

    expect(hasToolSelectionChanges(tools, ['mcp__echo'], new Set(['mcp__echo']))).toBe(false)
    expect(hasToolSelectionChanges(tools, ['mcp__echo'], new Set())).toBe(true)
    expect(hasToolSelectionChanges(tools, [], new Set())).toBe(true)
    expect(
      hasToolSelectionChanges(tools, ['mcp__echo', 'mcp__search'], new Set(['mcp__echo'])),
    ).toBe(true)
  })
})
