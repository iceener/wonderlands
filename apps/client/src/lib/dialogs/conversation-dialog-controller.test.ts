import { describe, expect, test } from 'vitest'
import { createConversationDialogController } from './conversation-dialog-controller.svelte.ts'

describe('createConversationDialogController', () => {
  test('submits rename and delete requests and returns to closed state', async () => {
    const controller = createConversationDialogController()

    const rename = controller.openRename({ currentTitle: 'Before' })
    expect(controller.currentRequest?.kind).toBe('rename')
    controller.submitRename('After')
    await expect(rename).resolves.toBe('After')

    const deletion = controller.openDelete({ currentTitle: 'After' })
    expect(controller.currentRequest?.kind).toBe('delete')
    controller.confirmDelete()
    await expect(deletion).resolves.toBe(true)
    expect({ isOpen: controller.isOpen, request: controller.currentRequest }).toEqual({
      isOpen: false,
      request: null,
    })
  })

  test('cancels each request type, including one replaced by a new request', async () => {
    const controller = createConversationDialogController()

    const replacedRename = controller.openRename({ currentTitle: 'One' })
    const deletion = controller.openDelete({ currentTitle: 'Two' })
    await expect(replacedRename).resolves.toBeNull()

    controller.cancel()
    await expect(deletion).resolves.toBe(false)

    const rename = controller.openRename({ currentTitle: 'Three' })
    controller.cancel()
    await expect(rename).resolves.toBeNull()
  })
})
