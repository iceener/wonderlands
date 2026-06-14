import type { PaletteStore } from '../command-palette/palette-store.svelte'
import type { PaletteProvider } from '../command-palette/types'
import type { AppCommands } from '../commands/app-commands'
import type { ResolvedShortcutBindings } from './default-bindings'
import type { ShortcutDefinition } from './types'

export interface AppShortcutDeps {
  appCommands: AppCommands
  bindings: ResolvedShortcutBindings
  paletteStore: PaletteStore
  commandsProvider: PaletteProvider
}

interface ActionHandler {
  description: string
  run: () => void | Promise<void>
  when?: () => boolean
}

export const createAppShortcutDefinitions = ({
  appCommands,
  bindings,
  paletteStore,
  commandsProvider,
}: AppShortcutDeps): ShortcutDefinition[] => {
  const handlers: Record<string, ActionHandler> = {
    'palette.toggle': {
      description: 'Toggle command palette',
      run: () => {
        paletteStore.openWith(commandsProvider)
      },
    },
    'chat.new-conversation': {
      description: 'Start a new conversation',
      when: () => appCommands.canStartNewConversation(),
      run: async () => {
        await appCommands.newConversation()
      },
    },
    'chat.switch-conversation': {
      description: 'Open the conversation picker',
      when: () => appCommands.canOpenConversationPicker(),
      run: () => {
        appCommands.openConversationPicker()
      },
    },
    'chat.previous-conversation': {
      description: 'Switch to the previous conversation',
      when: () => appCommands.canGoToPreviousConversation(),
      run: async () => {
        await appCommands.goToPreviousConversation()
      },
    },
    'chat.next-conversation': {
      description: 'Switch to the next conversation',
      when: () => appCommands.canGoToNextConversation(),
      run: async () => {
        await appCommands.goToNextConversation()
      },
    },
    'chat.rename-conversation': {
      description: 'Rename the current conversation',
      when: () => appCommands.canRenameConversation(),
      run: async () => {
        await appCommands.renameConversation()
      },
    },
    'chat.delete-conversation': {
      description: 'Delete the current conversation',
      when: () => appCommands.canDeleteConversation(),
      run: async () => {
        await appCommands.deleteConversation()
      },
    },
    'chat.upload-attachment': {
      description: 'Add file or image',
      when: () => appCommands.canPickAttachments(),
      run: () => {
        appCommands.pickAttachments()
      },
    },
    'settings.cycle-model': {
      description: 'Cycle the active model',
      when: () => appCommands.canCycleModel(),
      run: () => {
        appCommands.cycleModel()
      },
    },
    'settings.cycle-reasoning': {
      description: 'Cycle the reasoning mode',
      when: () => appCommands.canCycleReasoning(),
      run: () => {
        appCommands.cycleReasoning()
      },
    },
    'settings.cycle-theme': {
      description: 'Cycle the theme',
      when: () => appCommands.canCycleTheme(),
      run: () => {
        appCommands.cycleTheme()
      },
    },
    'settings.cycle-typewriter': {
      description: 'Cycle the typewriter speed',
      run: () => {
        appCommands.cycleTypewriter()
      },
    },
    'settings.keyboard-shortcuts': {
      description: 'Open keyboard shortcuts',
      when: () => appCommands.canOpenKeyboardShortcuts(),
      run: () => {
        appCommands.openKeyboardShortcuts()
      },
    },
    'agents.manage': {
      description: 'Manage agents',
      when: () => appCommands.canOpenAgentPanel(),
      run: () => {
        appCommands.openAgentPanel()
      },
    },
    'agents.new': {
      description: 'Create a new agent',
      when: () => appCommands.canOpenAgentPanel(),
      run: () => {
        appCommands.openNewAgent()
      },
    },
    'mcp.connect': {
      description: 'Connect MCP server',
      when: () => appCommands.canOpenConnectMcp(),
      run: () => {
        appCommands.openConnectMcp()
      },
    },
    'mcp.manage': {
      description: 'Manage MCP servers',
      when: () => appCommands.canOpenManageMcp(),
      run: () => {
        appCommands.openManageMcp()
      },
    },
    'mcp.tool-profiles': {
      description: 'Manage tool profiles',
      when: () => appCommands.canOpenManageToolProfiles(),
      run: () => {
        appCommands.openManageToolProfiles()
      },
    },
    'garden.manage': {
      description: 'Manage gardens',
      when: () => appCommands.canOpenManageGardens(),
      run: () => {
        appCommands.openManageGardens()
      },
    },
    'garden.new': {
      description: 'Create a new garden site',
      when: () => appCommands.canOpenManageGardens(),
      run: () => {
        appCommands.openNewGarden()
      },
    },
    'workspace.switch': {
      description: 'Switch workspace',
      when: () => appCommands.canOpenWorkspacePicker(),
      run: () => {
        appCommands.openWorkspacePicker()
      },
    },
    'account.sign-out': {
      description: 'Sign out',
      when: () => appCommands.canSignOut(),
      run: async () => {
        await appCommands.signOut()
      },
    },
  }

  const definitions: ShortcutDefinition[] = []

  for (const [actionId, keys] of Object.entries(bindings)) {
    if (keys == null) {
      continue
    }

    const handler = handlers[actionId]
    if (!handler) {
      continue
    }

    definitions.push({
      id: actionId,
      description: handler.description,
      keys: [keys],
      scope: 'global',
      allowInEditable: true,
      when: handler.when,
      run: handler.run,
    })
  }

  return definitions
}
