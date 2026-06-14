import { describe, expect, test } from 'vitest'
import type { AppCommands } from '../commands/app-commands'
import { resolveShortcutBindings } from '../shortcuts/default-bindings'

import { createCommandRegistry, createCommandsProvider } from './command-registry'

const defaultBindings = resolveShortcutBindings({})

const createAppCommandsStub = (overrides: Partial<AppCommands> = {}): AppCommands => ({
  canPickAttachments: () => true,
  canOpenAgentPanel: () => true,
  canOpenConnectMcp: () => true,
  canOpenKeyboardShortcuts: () => true,
  canOpenConversationPicker: () => true,
  canGoToPreviousConversation: () => true,
  canGoToNextConversation: () => true,
  canOpenWorkspacePicker: () => true,
  canRenameConversation: () => true,
  canDeleteConversation: () => true,
  canOpenManageMcp: () => true,
  canOpenManageGardens: () => true,
  canOpenManageToolProfiles: () => true,
  canCycleModel: () => true,
  canCycleReasoning: () => true,
  canCycleTheme: () => true,
  canSignOut: () => true,
  canStartNewConversation: () => true,
  openAgentPanel: () => true,
  openNewAgent: () => true,
  openKeyboardShortcuts: () => true,
  openConnectMcp: () => true,
  openConversationPicker: () => true,
  goToPreviousConversation: async () => true,
  goToNextConversation: async () => true,
  openWorkspacePicker: () => true,
  renameConversation: async () => true,
  deleteConversation: async () => true,
  openManageMcp: () => true,
  openManageGardens: () => true,
  openNewGarden: () => true,
  openManageToolProfiles: () => true,
  cycleModel: () => true,
  cycleReasoning: () => true,
  cycleTheme: () => true,
  cycleTypewriter: () => true,
  signOut: async () => true,
  newConversation: async () => true,
  pickAttachments: () => true,
  registerComposerBridge: () => () => {},
  ...overrides,
})

describe('createCommandsProvider', () => {
  test('returns a provider with command mode', async () => {
    const provider = createCommandsProvider(createAppCommandsStub(), () => defaultBindings)

    expect(provider.id).toBe('commands')
    expect(provider.mode).toBe('command')
  })

  test('getItems returns all enabled items for empty query', async () => {
    const provider = createCommandsProvider(createAppCommandsStub(), () => defaultBindings)
    const results = provider.getItems('')

    expect(results.length).toBeGreaterThan(0)
  })

  test('getItems filters by query', async () => {
    const provider = createCommandsProvider(createAppCommandsStub(), () => defaultBindings)
    const results = provider.getItems('new')

    expect(results.length).toBe(3)
    expect(results.map((result) => result.item.id).sort()).toEqual([
      'agents.new',
      'chat.new-conversation',
      'garden.new',
    ])
  })

  test('onSelect calls the item run', async () => {
    let called = false
    const provider = createCommandsProvider(
      createAppCommandsStub({
        cycleModel: () => {
          called = true
          return true
        },
      }),
      () => defaultBindings,
    )
    const results = provider.getItems('cycle model')
    provider.onSelect(results[0].item)

    expect(called).toBe(true)
  })
})

describe('createCommandRegistry', () => {
  test('returns a non-empty array of command items', async () => {
    const commands = createCommandRegistry(createAppCommandsStub(), defaultBindings)

    expect(commands.length).toBeGreaterThan(0)
  })

  test('every command has a unique id', async () => {
    const commands = createCommandRegistry(createAppCommandsStub(), defaultBindings)
    const ids = commands.map((c) => c.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every command has a non-empty label and group', async () => {
    const commands = createCommandRegistry(createAppCommandsStub(), defaultBindings)

    for (const command of commands) {
      expect(command.label.length).toBeGreaterThan(0)
      expect(command.group.length).toBeGreaterThan(0)
    }
  })

  test('chat commands are listed first and start with new conversation', async () => {
    const commands = createCommandRegistry(createAppCommandsStub(), defaultBindings)

    expect(commands[0]?.id).toBe('chat.new-conversation')
    expect(commands[1]?.id).toBe('chat.upload-attachment')
    expect(commands[2]?.id).toBe('chat.switch-conversation')
  })

  test('enabled delegates to the underlying appCommands guard', async () => {
    const stub = createAppCommandsStub({ canCycleModel: () => false })
    const commands = createCommandRegistry(stub, defaultBindings)
    const cycleModel = commands.find((c) => c.id === 'settings.cycle-model')

    expect(cycleModel?.enabled()).toBe(false)
  })

  test('run delegates to the underlying appCommands action', async () => {
    let called = false
    const stub = createAppCommandsStub({
      cycleModel: () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const cycleModel = commands.find((c) => c.id === 'settings.cycle-model')

    cycleModel?.run()
    expect(called).toBe(true)
  })

  test('manage agents command delegates to appCommands.openAgentPanel', async () => {
    let called = false
    const stub = createAppCommandsStub({
      openAgentPanel: () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const manageAgents = commands.find((command) => command.id === 'agents.manage')

    manageAgents?.run()
    expect(called).toBe(true)
  })

  test('connect MCP command delegates to appCommands.openConnectMcp', async () => {
    let called = false
    const stub = createAppCommandsStub({
      openConnectMcp: () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const connectMcp = commands.find((command) => command.id === 'mcp.connect')

    connectMcp?.run()
    expect(called).toBe(true)
  })

  test('manage MCP command delegates to appCommands.openManageMcp', async () => {
    let called = false
    const stub = createAppCommandsStub({
      openManageMcp: () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const manageMcp = commands.find((command) => command.id === 'mcp.manage')

    manageMcp?.run()
    expect(called).toBe(true)
  })

  test('new conversation command delegates to appCommands.newConversation', async () => {
    let called = false
    const stub = createAppCommandsStub({
      newConversation: async () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const newConvo = commands.find((c) => c.id === 'chat.new-conversation')

    await newConvo?.run()
    expect(called).toBe(true)
  })

  test('switch conversation command delegates to appCommands.openConversationPicker', async () => {
    let called = false
    const stub = createAppCommandsStub({
      openConversationPicker: () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const switchConversation = commands.find((command) => command.id === 'chat.switch-conversation')

    switchConversation?.run()
    expect(called).toBe(true)
  })

  test('previous conversation command delegates to appCommands.goToPreviousConversation', async () => {
    let called = false
    const stub = createAppCommandsStub({
      goToPreviousConversation: async () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const previousConversation = commands.find(
      (command) => command.id === 'chat.previous-conversation',
    )

    await previousConversation?.run()
    expect(called).toBe(true)
  })

  test('next conversation command delegates to appCommands.goToNextConversation', async () => {
    let called = false
    const stub = createAppCommandsStub({
      goToNextConversation: async () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const nextConversation = commands.find((command) => command.id === 'chat.next-conversation')

    await nextConversation?.run()
    expect(called).toBe(true)
  })

  test('upload attachment command delegates to appCommands.pickAttachments', async () => {
    let called = false
    const stub = createAppCommandsStub({
      pickAttachments: () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const uploadAttachment = commands.find((command) => command.id === 'chat.upload-attachment')

    uploadAttachment?.run()
    expect(called).toBe(true)
  })

  test('switch workspace command delegates to appCommands.openWorkspacePicker', async () => {
    let called = false
    const stub = createAppCommandsStub({
      openWorkspacePicker: () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const switchWorkspace = commands.find((command) => command.id === 'workspace.switch')

    switchWorkspace?.run()
    expect(called).toBe(true)
  })

  test('palette-only commands stay out of slash suggestions', async () => {
    const commands = createCommandRegistry(createAppCommandsStub(), defaultBindings)
    const signOut = commands.find((command) => command.id === 'account.sign-out')
    const cycleTheme = commands.find((command) => command.id === 'settings.cycle-theme')
    const switchWorkspace = commands.find((command) => command.id === 'workspace.switch')

    expect(signOut?.surfaces).toEqual(['palette'])
    expect(cycleTheme?.surfaces).toEqual(['palette', 'slash'])
    expect(switchWorkspace?.surfaces).toEqual(['palette'])
  })

  test('add file or image is available in both palette and slash surfaces', async () => {
    const commands = createCommandRegistry(createAppCommandsStub(), defaultBindings)
    const uploadAttachment = commands.find((command) => command.id === 'chat.upload-attachment')

    expect(uploadAttachment?.surfaces).toEqual(['palette', 'slash'])
  })

  test('sign out command delegates to appCommands.signOut', async () => {
    let called = false
    const stub = createAppCommandsStub({
      signOut: async () => {
        called = true
        return true
      },
    })
    const commands = createCommandRegistry(stub, defaultBindings)
    const signOut = commands.find((command) => command.id === 'account.sign-out')

    await signOut?.run()
    expect(called).toBe(true)
  })
})
