import { asAgentId, type BackendAgentSummary } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { createAgentProvider } from './agent-provider.svelte.ts'

const createAgent = (
  id: string,
  name: string,
  visibility: BackendAgentSummary['visibility'],
  overrides: Partial<BackendAgentSummary> = {},
): BackendAgentSummary => ({
  activeRevisionId: 'rev_1',
  activeRevisionVersion: 1,
  createdAt: '2026-03-30T10:00:00.000Z',
  description: null,
  id: asAgentId(id),
  isDefaultForAccount: false,
  kind: 'specialist',
  name,
  ownerAccountId: 'acc_1',
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  status: 'active',
  updatedAt: '2026-03-30T10:00:00.000Z',
  visibility,
  ...overrides,
})

describe('createAgentProvider', () => {
  test('calls listAgents on first getItems and reuses the cached list', async () => {
    let listCalls = 0

    const provider = createAgentProvider({
      listAgents: async () => {
        listCalls += 1
        return [
          createAgent('agt_1', 'Researcher', 'account_private'),
          createAgent('agt_2', 'Reviewer', 'tenant_shared'),
        ]
      },
      onSelectAgent: () => undefined,
    })

    provider.getItems('')
    await Promise.resolve()
    await Promise.resolve()

    const first = provider.getItems('')
    const second = provider.getItems('review')

    expect(listCalls).toBe(1)
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(1)
    expect(second[0]?.item.label).toBe('Reviewer')
  })

  test('groups agents by visibility and marks the default account agent', async () => {
    const provider = createAgentProvider({
      listAgents: async () => [
        createAgent('agt_1', 'Personal Planner', 'account_private', {
          isDefaultForAccount: true,
        }),
        createAgent('agt_2', 'Team Reviewer', 'tenant_shared'),
        createAgent('agt_3', 'System Analyst', 'system'),
      ],
      onSelectAgent: () => undefined,
    })

    provider.getItems('')
    await Promise.resolve()
    await Promise.resolve()

    const results = provider.getItems('')

    expect(results.map((result) => result.item.group)).toEqual([
      'My Agents',
      'Shared Agents',
      'System',
    ])
    expect(results[0]?.item.shortcutHint).toBe('default')
  })

  test('calls onSelectAgent when an item is selected', async () => {
    const selected: string[] = []

    const provider = createAgentProvider({
      listAgents: async () => [createAgent('agt_1', 'Researcher', 'account_private')],
      onSelectAgent: (agent) => {
        selected.push(agent.id)
      },
    })

    provider.getItems('')
    await Promise.resolve()
    await Promise.resolve()

    const item = provider.getItems('research')[0]?.item
    expect(item).toBeDefined()

    if (item) {
      provider.onSelect(item)
    }

    expect(selected).toEqual(['agt_1'])
  })

  test('resets the cache on dismiss so the next open refetches agents', async () => {
    let listCalls = 0

    const provider = createAgentProvider({
      listAgents: async () => {
        listCalls += 1
        return [createAgent(`agt_${listCalls}`, 'Researcher', 'account_private')]
      },
      onSelectAgent: () => undefined,
    })

    provider.getItems('')
    await Promise.resolve()
    await Promise.resolve()
    provider.onDismiss?.()

    provider.getItems('')
    await Promise.resolve()
    await Promise.resolve()

    expect(listCalls).toBe(2)
  })
})
