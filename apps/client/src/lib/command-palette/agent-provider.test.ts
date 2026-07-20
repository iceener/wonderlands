import { asAgentId, type BackendAgentSummary } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { createAgentProvider } from './agent-provider.svelte.ts'

const createAgent = (
  id: string,
  name: string,
  visibility: BackendAgentSummary['visibility'],
  isDefaultForAccount = false,
): BackendAgentSummary => ({
  activeRevisionId: 'rev_1',
  activeRevisionVersion: 1,
  createdAt: '2026-03-30T10:00:00.000Z',
  description: null,
  id: asAgentId(id),
  isDefaultForAccount,
  kind: 'specialist',
  name,
  ownerAccountId: 'acc_1',
  slug: name.toLowerCase(),
  status: 'active',
  updatedAt: '2026-03-30T10:00:00.000Z',
  visibility,
})

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createAgentProvider', () => {
  test('loads once, filters the cached visibility groups, and delegates selection', async () => {
    let listCalls = 0
    const selected: string[] = []
    const provider = createAgentProvider({
      listAgents: async () => {
        listCalls += 1
        return [
          createAgent('agt_private', 'Alpha', 'account_private', true),
          createAgent('agt_shared', 'Beta', 'tenant_shared'),
          createAgent('agt_system', 'Gamma', 'system'),
        ]
      },
      onSelectAgent: (agent) => selected.push(agent.id),
    })

    provider.getItems('')
    await flush()
    const all = provider.getItems('')
    const filtered = provider.getItems('beta')

    expect(listCalls).toBe(1)
    expect(all.map(({ item }) => [item.id, item.group])).toEqual([
      ['agt_private', 'My Agents'],
      ['agt_shared', 'Shared Agents'],
      ['agt_system', 'System'],
    ])
    expect(all[0]?.item.shortcutHint).toBe('default')
    expect(filtered.map(({ item }) => item.id)).toEqual(['agt_shared'])

    if (filtered[0]) provider.onSelect(filtered[0].item)
    await flush()
    expect(selected).toEqual(['agt_shared'])
  })

  test('clears its async cache on dismiss and refetches on the next read', async () => {
    let listCalls = 0
    const provider = createAgentProvider({
      listAgents: async () => {
        listCalls += 1
        return [createAgent(`agt_${listCalls}`, 'Alpha', 'account_private')]
      },
      onSelectAgent: () => undefined,
    })

    provider.getItems('')
    await flush()
    provider.onDismiss?.()
    provider.getItems('')
    await flush()

    expect(listCalls).toBe(2)
    expect(provider.getItems('')[0]?.item.id).toBe('agt_2')
  })
})
