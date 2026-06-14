import { describe, expect, test } from 'vitest'
import { createRenameProvider } from './rename-provider'

describe('createRenameProvider', () => {
  test('exposes an auto-rename input action with dynamic naming state', async () => {
    const calls: string[] = []
    let naming = false

    const provider = createRenameProvider({
      currentTitle: 'Current title',
      onRename: () => undefined,
      onRegenerate: () => {
        calls.push('regenerate')
      },
      canRegenerate: () => !naming,
      isRegenerating: () => naming,
      onCancel: () => undefined,
    })

    expect(provider.inputAction?.label()).toBe('Auto-rename')
    expect(provider.inputAction?.disabled?.()).toBe(false)

    await provider.inputAction?.run()
    expect(calls).toEqual(['regenerate'])

    naming = true
    expect(provider.inputAction?.label()).toBe('Naming…')
    expect(provider.inputAction?.disabled?.()).toBe(true)
  })

  test('uses the latest thread title when deciding whether the rename is dirty', async () => {
    let currentTitle = 'Initial title'

    const provider = createRenameProvider({
      currentTitle,
      getCurrentTitle: () => currentTitle,
      onRename: () => undefined,
      onCancel: () => undefined,
    })

    provider.onOpen?.()
    expect(provider.getItems('')[0]?.item.id).toBe('rename.hint')

    currentTitle = 'Generated title'
    provider.onQueryChange?.('Generated title')

    expect(provider.getItems('Generated title')[0]?.item.id).toBe('rename.hint')
  })
})
