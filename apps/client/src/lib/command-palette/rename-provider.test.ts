import { describe, expect, test } from 'vitest'
import { createRenameProvider } from './rename-provider'

describe('createRenameProvider', () => {
  test('submits a trimmed dirty title and follows the latest current title', () => {
    let currentTitle = 'Initial'
    const renamed: string[] = []
    const provider = createRenameProvider({
      currentTitle,
      getCurrentTitle: () => currentTitle,
      onRename: (title) => renamed.push(title),
      onCancel: () => undefined,
    })

    provider.onOpen?.()
    expect(provider.getItems('')[0]?.item.id).toBe('rename.hint')

    provider.onQueryChange?.('  Next title  ')
    const confirmation = provider.getItems('')[0]?.item
    expect(confirmation?.id).toBe('rename.confirm')
    if (confirmation) provider.onSelect(confirmation)
    expect(renamed).toEqual(['Next title'])

    currentTitle = 'Generated'
    provider.onQueryChange?.('Generated')
    expect(provider.getItems('')[0]?.item.id).toBe('rename.hint')
  })

  test('delegates auto-rename and reflects its availability state', async () => {
    let regenerating = false
    let calls = 0
    const provider = createRenameProvider({
      currentTitle: 'Initial',
      onRename: () => undefined,
      onRegenerate: () => {
        calls += 1
      },
      canRegenerate: () => !regenerating,
      isRegenerating: () => regenerating,
      onCancel: () => undefined,
    })

    expect(provider.inputAction?.disabled?.()).toBe(false)
    await provider.inputAction?.run()
    expect(calls).toBe(1)

    regenerating = true
    expect(provider.inputAction?.disabled?.()).toBe(true)
  })
})
