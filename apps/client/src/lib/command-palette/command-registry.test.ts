import { describe, expect, test, vi } from 'vitest'
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
  canOpenManageAgentTasks: () => true,
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
  openManageAgentTasks: () => true,
  openNewAgentTask: () => true,
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

type CommandCase = {
  id: string
  guard?: keyof AppCommands
  action: keyof AppCommands
  surfaces?: readonly ('palette' | 'slash')[]
}

const commandCases: readonly CommandCase[] = [
  { id: 'chat.new-conversation', guard: 'canStartNewConversation', action: 'newConversation' },
  {
    id: 'chat.upload-attachment',
    guard: 'canPickAttachments',
    action: 'pickAttachments',
    surfaces: ['palette', 'slash'],
  },
  {
    id: 'chat.switch-conversation',
    guard: 'canOpenConversationPicker',
    action: 'openConversationPicker',
  },
  {
    id: 'chat.previous-conversation',
    guard: 'canGoToPreviousConversation',
    action: 'goToPreviousConversation',
  },
  {
    id: 'chat.next-conversation',
    guard: 'canGoToNextConversation',
    action: 'goToNextConversation',
  },
  {
    id: 'chat.rename-conversation',
    guard: 'canRenameConversation',
    action: 'renameConversation',
  },
  {
    id: 'chat.delete-conversation',
    guard: 'canDeleteConversation',
    action: 'deleteConversation',
  },
  { id: 'agents.manage', guard: 'canOpenAgentPanel', action: 'openAgentPanel' },
  { id: 'agents.new', guard: 'canOpenAgentPanel', action: 'openNewAgent' },
  { id: 'mcp.connect', guard: 'canOpenConnectMcp', action: 'openConnectMcp' },
  { id: 'mcp.manage', guard: 'canOpenManageMcp', action: 'openManageMcp' },
  {
    id: 'mcp.tool-profiles',
    guard: 'canOpenManageToolProfiles',
    action: 'openManageToolProfiles',
  },
  {
    id: 'agent-tasks.manage',
    guard: 'canOpenManageAgentTasks',
    action: 'openManageAgentTasks',
  },
  {
    id: 'agent-tasks.new',
    guard: 'canOpenManageAgentTasks',
    action: 'openNewAgentTask',
  },
  { id: 'garden.manage', guard: 'canOpenManageGardens', action: 'openManageGardens' },
  { id: 'garden.new', guard: 'canOpenManageGardens', action: 'openNewGarden' },
  {
    id: 'workspace.switch',
    guard: 'canOpenWorkspacePicker',
    action: 'openWorkspacePicker',
    surfaces: ['palette'],
  },
  { id: 'settings.cycle-model', guard: 'canCycleModel', action: 'cycleModel' },
  {
    id: 'settings.cycle-reasoning',
    guard: 'canCycleReasoning',
    action: 'cycleReasoning',
  },
  {
    id: 'settings.cycle-theme',
    guard: 'canCycleTheme',
    action: 'cycleTheme',
    surfaces: ['palette', 'slash'],
  },
  { id: 'settings.cycle-typewriter', action: 'cycleTypewriter' },
  {
    id: 'settings.keyboard-shortcuts',
    guard: 'canOpenKeyboardShortcuts',
    action: 'openKeyboardShortcuts',
    surfaces: ['palette', 'slash'],
  },
  {
    id: 'account.sign-out',
    guard: 'canSignOut',
    action: 'signOut',
    surfaces: ['palette'],
  },
]

describe('command registry', () => {
  test('keeps the complete command ID order and surface boundaries', () => {
    const commands = createCommandRegistry(createAppCommandsStub(), defaultBindings)

    expect(commands.map(({ id }) => id)).toEqual(commandCases.map(({ id }) => id))
    expect(new Set(commands.map(({ id }) => id))).toHaveLength(commands.length)

    for (const scenario of commandCases) {
      expect(commands.find(({ id }) => id === scenario.id)?.surfaces).toEqual(scenario.surfaces)
    }
  })

  test('delegates every enabled guard and action through the registry table', async () => {
    for (const scenario of commandCases) {
      const appCommands = createAppCommandsStub()
      const action = vi.fn(() => true)
      Object.assign(appCommands, { [scenario.action]: action })

      const guard = scenario.guard ? vi.fn(() => false) : null
      if (scenario.guard && guard) Object.assign(appCommands, { [scenario.guard]: guard })

      const command = createCommandRegistry(appCommands, defaultBindings).find(
        ({ id }) => id === scenario.id,
      )
      expect(command, scenario.id).toBeDefined()

      if (guard) {
        expect(command?.enabled(), `${scenario.id} disabled`).toBe(false)
        guard.mockReturnValue(true)
      } else {
        expect(command?.enabled(), `${scenario.id} enabled`).toBe(true)
      }

      await command?.run()
      expect(action, scenario.id).toHaveBeenCalledOnce()
    }
  })

  test('exposes command mode, filters disabled commands, and runs the selected result', () => {
    const cycleTypewriter = vi.fn(() => true)
    const provider = createCommandsProvider(
      createAppCommandsStub({ canCycleModel: () => false, cycleTypewriter }),
      () => defaultBindings,
    )

    expect({ id: provider.id, mode: provider.mode }).toEqual({ id: 'commands', mode: 'command' })
    expect(provider.getItems('').some(({ item }) => item.id === 'settings.cycle-model')).toBe(false)

    const selected = provider.getItems('typewriter')[0]?.item
    expect(selected?.id).toBe('settings.cycle-typewriter')
    if (selected) provider.onSelect(selected)
    expect(cycleTypewriter).toHaveBeenCalledOnce()
  })
})
