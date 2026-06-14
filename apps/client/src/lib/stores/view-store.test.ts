import { describe, expect, test, vi } from 'vitest'
import { createViewNavigator } from './view-store.svelte.js'

describe('createViewNavigator', () => {
  test('push keeps previous views mounted and derives back labels from the stack', () => {
    const navigator = createViewNavigator(async () => true)

    navigator.push({ kind: 'agent-form', agentId: 'agt_1' })

    expect(navigator.activeView).toEqual({ kind: 'agent-form', agentId: 'agt_1' })
    expect(navigator.mountedViews).toEqual([
      { kind: 'chat' },
      { kind: 'agent-form', agentId: 'agt_1' },
    ])
    expect(navigator.backLabel).toBe('Back to Chat')

    navigator.push({ kind: 'tool-profile-form', toolProfileId: 'tp_1' })

    expect(navigator.activeView).toEqual({ kind: 'tool-profile-form', toolProfileId: 'tp_1' })
    expect(navigator.mountedViews).toEqual([
      { kind: 'chat' },
      { kind: 'agent-form', agentId: 'agt_1' },
      { kind: 'tool-profile-form', toolProfileId: 'tp_1' },
    ])
    expect(navigator.backLabel).toBe('Back to Agent')
  })

  test('requestPop blocks when the active view is dirty and discard is cancelled', async () => {
    const openConfirm = vi.fn(async () => false)
    const navigator = createViewNavigator(openConfirm)
    const agentView = { kind: 'agent-form' as const, agentId: 'agt_1' }

    navigator.push(agentView)
    navigator.registerDirtyGuard(agentView, () => true)

    await expect(navigator.requestPop()).resolves.toBe(false)
    expect(navigator.activeView).toEqual(agentView)
    expect(openConfirm).toHaveBeenCalledWith({
      cancelLabel: 'Keep editing',
      confirmLabel: 'Discard changes',
      title: 'You have unsaved changes',
    })
  })

  test('buried dirty views survive push/pop without confirmation', async () => {
    const openConfirm = vi.fn(async () => true)
    const navigator = createViewNavigator(openConfirm)
    const agentView = { kind: 'agent-form' as const, agentId: 'agt_1' }
    const profileView = { kind: 'tool-profile-form' as const, toolProfileId: 'tp_1' }

    navigator.push(agentView)
    navigator.registerDirtyGuard(agentView, () => true)
    navigator.push(profileView)

    expect(navigator.isDirty).toBe(false)

    await expect(navigator.requestPop()).resolves.toBe(true)

    expect(openConfirm).not.toHaveBeenCalled()
    expect(navigator.activeView).toEqual(agentView)
    expect(navigator.isDirty).toBe(true)
  })

  test('resetToChat clears the stack and active dirty state', () => {
    const navigator = createViewNavigator(async () => true)
    const agentView = { kind: 'agent-form' as const, agentId: 'agt_1' }
    const mcpView = { kind: 'mcp-form' as const, serverId: 'srv_1' }

    navigator.push(agentView)
    navigator.registerDirtyGuard(agentView, () => true)
    navigator.push(mcpView)
    navigator.registerDirtyGuard(mcpView, () => true)

    navigator.resetToChat()

    expect(navigator.activeView).toEqual({ kind: 'chat' })
    expect(navigator.mountedViews).toEqual([{ kind: 'chat' }])
    expect(navigator.canGoBack).toBe(false)
    expect(navigator.isDirty).toBe(false)
    expect(navigator.backLabel).toBeNull()
  })
})
