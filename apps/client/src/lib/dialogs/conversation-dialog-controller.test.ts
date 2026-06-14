import { describe, expect, test } from 'vitest'
import { createConversationDialogController } from './conversation-dialog-controller.svelte.ts'

describe('createConversationDialogController', () => {
  test('opens and resolves rename requests', async () => {
    const controller = createConversationDialogController()

    const pending = controller.openRename({
      currentTitle: 'Current thread',
    })

    expect(controller.isOpen).toBe(true)
    expect(controller.currentRequest).toEqual({
      currentTitle: 'Current thread',
      kind: 'rename',
    })

    controller.submitRename('Renamed thread')

    await expect(pending).resolves.toBe('Renamed thread')
    expect(controller.isOpen).toBe(false)
    expect(controller.currentRequest).toBeNull()
  })

  test('cancels rename requests with null and delete requests with false', async () => {
    const controller = createConversationDialogController()

    const renamePending = controller.openRename({
      currentTitle: 'Current thread',
    })
    controller.cancel()
    await expect(renamePending).resolves.toBeNull()

    const deletePending = controller.openDelete({
      currentTitle: 'Current thread',
    })
    controller.cancel()
    await expect(deletePending).resolves.toBe(false)
  })
})
