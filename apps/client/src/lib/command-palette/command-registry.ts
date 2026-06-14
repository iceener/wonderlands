import type { AppCommands } from '../commands/app-commands'
import { formatShortcutHint, type ResolvedShortcutBindings } from '../shortcuts/default-bindings'
import { searchCommands } from './search'
import type { CommandItem, PaletteProvider } from './types'

export const createCommandsProvider = (
  appCommands: AppCommands,
  getBindings: () => ResolvedShortcutBindings,
): PaletteProvider => ({
  id: 'commands',
  mode: 'command',
  getItems: (query) => searchCommands(query, createCommandRegistry(appCommands, getBindings())),
  onSelect: (item) => {
    void item.run()
  },
})

const hintFor = (bindings: ResolvedShortcutBindings, actionId: string): string | undefined => {
  const keys = bindings[actionId]
  return keys ? formatShortcutHint(keys) : undefined
}

export const createCommandRegistry = (
  appCommands: AppCommands,
  bindings: ResolvedShortcutBindings,
): CommandItem[] => [
  {
    id: 'chat.new-conversation',
    label: 'New Conversation',
    group: 'Chat',
    navigationType: 'instant',
    shortcutHint: hintFor(bindings, 'chat.new-conversation'),
    keywords: ['reset', 'clear', 'start', 'fresh'],
    enabled: () => appCommands.canStartNewConversation(),
    run: async () => {
      await appCommands.newConversation()
    },
  },
  {
    id: 'chat.upload-attachment',
    label: 'Add file or image',
    group: 'Chat',
    navigationType: 'instant',
    shortcutHint: hintFor(bindings, 'chat.upload-attachment'),
    keywords: ['attach', 'attachment', 'upload', 'file', 'image', 'document'],
    surfaces: ['palette', 'slash'],
    enabled: () => appCommands.canPickAttachments(),
    run: () => {
      appCommands.pickAttachments()
    },
  },
  {
    id: 'chat.switch-conversation',
    label: 'Switch Conversation',
    group: 'Chat',
    navigationType: 'browser',
    shortcutHint: hintFor(bindings, 'chat.switch-conversation'),
    keywords: ['thread', 'history', 'conversations', 'recent', 'switch'],
    enabled: () => appCommands.canOpenConversationPicker(),
    run: () => {
      appCommands.openConversationPicker()
    },
  },
  {
    id: 'chat.previous-conversation',
    label: 'Previous Conversation',
    group: 'Chat',
    navigationType: 'instant',
    shortcutHint: hintFor(bindings, 'chat.previous-conversation'),
    keywords: ['previous', 'back', 'thread', 'history', 'conversation'],
    enabled: () => appCommands.canGoToPreviousConversation(),
    run: async () => {
      await appCommands.goToPreviousConversation()
    },
  },
  {
    id: 'chat.next-conversation',
    label: 'Next Conversation',
    group: 'Chat',
    navigationType: 'instant',
    shortcutHint: hintFor(bindings, 'chat.next-conversation'),
    keywords: ['next', 'forward', 'thread', 'history', 'conversation'],
    enabled: () => appCommands.canGoToNextConversation(),
    run: async () => {
      await appCommands.goToNextConversation()
    },
  },
  {
    id: 'chat.rename-conversation',
    label: 'Rename Conversation',
    group: 'Chat',
    navigationType: 'dialog',
    shortcutHint: hintFor(bindings, 'chat.rename-conversation'),
    keywords: ['rename', 'title'],
    enabled: () => appCommands.canRenameConversation(),
    run: async () => {
      await appCommands.renameConversation()
    },
  },
  {
    id: 'chat.delete-conversation',
    label: 'Delete Conversation',
    group: 'Chat',
    navigationType: 'dialog',
    keywords: ['delete', 'remove'],
    enabled: () => appCommands.canDeleteConversation(),
    run: async () => {
      await appCommands.deleteConversation()
    },
  },
  {
    id: 'agents.manage',
    label: 'Manage Agents',
    group: 'Agents',
    navigationType: 'browser',
    shortcutHint: hintFor(bindings, 'agents.manage'),
    keywords: ['agents', 'manage', 'edit', 'configure', 'browse'],
    enabled: () => appCommands.canOpenAgentPanel(),
    run: () => {
      appCommands.openAgentPanel()
    },
  },
  {
    id: 'agents.new',
    label: 'New Agent',
    group: 'Agents',
    navigationType: 'form',
    keywords: ['create', 'new', 'agent'],
    enabled: () => appCommands.canOpenAgentPanel(),
    run: () => {
      appCommands.openNewAgent()
    },
  },
  {
    id: 'mcp.connect',
    label: 'Connect MCP',
    group: 'Integrations',
    navigationType: 'form',
    keywords: ['model context protocol', 'server', 'tool', 'stdio', 'streamable', 'http'],
    enabled: () => appCommands.canOpenConnectMcp(),
    run: () => {
      appCommands.openConnectMcp()
    },
  },
  {
    id: 'mcp.manage',
    label: 'Manage MCP Servers',
    group: 'Integrations',
    navigationType: 'browser',
    keywords: ['model context protocol', 'server', 'edit', 'refresh', 'connections', 'tools'],
    enabled: () => appCommands.canOpenManageMcp(),
    run: () => {
      appCommands.openManageMcp()
    },
  },
  {
    id: 'mcp.tool-profiles',
    label: 'Manage Tool Profiles',
    group: 'Integrations',
    navigationType: 'browser',
    keywords: ['tool access', 'profiles', 'mcp', 'permissions', 'grants'],
    enabled: () => appCommands.canOpenManageToolProfiles(),
    run: () => {
      appCommands.openManageToolProfiles()
    },
  },
  {
    id: 'agent-tasks.manage',
    label: 'Manage Scheduled Tasks',
    group: 'Agents',
    navigationType: 'browser',
    keywords: ['scheduled', 'task', 'cron', 'automation', 'recurring', 'agent', 'schedule'],
    enabled: () => appCommands.canOpenManageAgentTasks(),
    run: () => {
      appCommands.openManageAgentTasks()
    },
  },
  {
    id: 'agent-tasks.new',
    label: 'New Scheduled Task',
    group: 'Agents',
    navigationType: 'form',
    keywords: ['scheduled', 'task', 'cron', 'automation', 'recurring', 'agent', 'create', 'new'],
    enabled: () => appCommands.canOpenManageAgentTasks(),
    run: () => {
      appCommands.openNewAgentTask()
    },
  },
  {
    id: 'garden.manage',
    label: 'Manage Gardens',
    group: 'Garden',
    navigationType: 'browser',
    keywords: ['garden', 'publish', 'site', 'preview', 'admin'],
    enabled: () => appCommands.canOpenManageGardens(),
    run: () => {
      appCommands.openManageGardens()
    },
  },
  {
    id: 'garden.new',
    label: 'New Garden Site',
    group: 'Garden',
    navigationType: 'form',
    keywords: ['garden', 'publish', 'site', 'create', 'new'],
    enabled: () => appCommands.canOpenManageGardens(),
    run: () => {
      appCommands.openNewGarden()
    },
  },
  {
    id: 'workspace.switch',
    label: 'Switch Workspace',
    group: 'Workspace',
    navigationType: 'browser',
    keywords: ['workspace', 'tenant', 'account', 'organization'],
    surfaces: ['palette'],
    enabled: () => appCommands.canOpenWorkspacePicker(),
    run: () => {
      appCommands.openWorkspacePicker()
    },
  },
  {
    id: 'settings.cycle-model',
    label: 'Cycle Model',
    group: 'Settings',
    navigationType: 'instant',
    shortcutHint: hintFor(bindings, 'settings.cycle-model'),
    keywords: ['switch', 'model', 'gpt', 'change'],
    enabled: () => appCommands.canCycleModel(),
    run: () => {
      appCommands.cycleModel()
    },
  },
  {
    id: 'settings.cycle-reasoning',
    label: 'Cycle Reasoning Mode',
    group: 'Settings',
    navigationType: 'instant',
    shortcutHint: hintFor(bindings, 'settings.cycle-reasoning'),
    keywords: ['reasoning', 'effort', 'thinking'],
    enabled: () => appCommands.canCycleReasoning(),
    run: () => {
      appCommands.cycleReasoning()
    },
  },
  {
    id: 'settings.cycle-theme',
    label: 'Cycle Theme',
    group: 'Settings',
    navigationType: 'instant',
    shortcutHint: hintFor(bindings, 'settings.cycle-theme'),
    surfaces: ['palette', 'slash'],
    keywords: ['appearance', 'light', 'dark', 'system'],
    enabled: () => appCommands.canCycleTheme(),
    run: () => {
      appCommands.cycleTheme()
    },
  },
  {
    id: 'settings.cycle-typewriter',
    label: 'Cycle Typewriter Speed',
    group: 'Settings',
    navigationType: 'instant',
    shortcutHint: hintFor(bindings, 'settings.cycle-typewriter'),
    keywords: ['animation', 'speed', 'typewriter', 'slow', 'fast'],
    enabled: () => true,
    run: () => {
      appCommands.cycleTypewriter()
    },
  },
  {
    id: 'settings.keyboard-shortcuts',
    label: 'Keyboard Shortcuts',
    group: 'Settings',
    navigationType: 'form',
    keywords: ['keybindings', 'hotkeys', 'keys', 'shortcuts', 'bindings'],
    surfaces: ['palette', 'slash'],
    enabled: () => appCommands.canOpenKeyboardShortcuts(),
    run: () => {
      appCommands.openKeyboardShortcuts()
    },
  },
  {
    id: 'account.sign-out',
    label: 'Sign Out',
    group: 'Account',
    navigationType: 'instant',
    keywords: ['logout', 'log out', 'sign out', 'session'],
    surfaces: ['palette'],
    enabled: () => appCommands.canSignOut(),
    run: async () => {
      await appCommands.signOut()
    },
  },
]
