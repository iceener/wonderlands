<script lang="ts">
import { onMount, tick } from 'svelte'
import {
  shouldRenderMainShell,
  shouldShowBlankAuthScreen,
  shouldShowConnectingWorkspaceScreen,
  shouldShowLoginScreen,
  shouldShowNoWorkspaceScreen,
} from './lib/app-shell-auth'
import { createAgentBrowserProvider } from './lib/command-palette/agent-browser-provider.svelte'
import { createAgentTaskBrowserProvider } from './lib/command-palette/agent-task-browser-provider.svelte'
import {
  createCommandRegistry,
  createCommandsProvider,
} from './lib/command-palette/command-registry'
import { createConfirmProvider } from './lib/command-palette/confirm-provider'
import { createConversationProvider } from './lib/command-palette/conversation-provider.svelte'
import { createGardenBrowserProvider } from './lib/command-palette/garden-browser-provider.svelte'
import { createMcpBrowserProvider } from './lib/command-palette/mcp-browser-provider.svelte'
import PalettePopover from './lib/command-palette/PalettePopover.svelte'
import {
  createPaletteStore,
  setPaletteStoreContext,
} from './lib/command-palette/palette-store.svelte'
import { createRenameProvider } from './lib/command-palette/rename-provider'
import { createToolProfileBrowserProvider } from './lib/command-palette/tool-profile-browser-provider.svelte'
import { createWorkspaceProvider } from './lib/command-palette/workspace-provider.svelte'
import { createAppCommands, setAppCommandsContext } from './lib/commands/app-commands'
import AgentTaskForm from './lib/components/agent-tasks/AgentTaskForm.svelte'
import AgentForm from './lib/components/agents/AgentForm.svelte'
import BackgroundActivityBar from './lib/components/composer/BackgroundActivityBar.svelte'
import ChatComposer from './lib/components/composer/ChatComposer.svelte'
import GardenArchivePanel from './lib/components/garden/GardenArchivePanel.svelte'
import GardenForm from './lib/components/garden/GardenForm.svelte'
import KeyboardShortcutsForm from './lib/components/keyboard-shortcuts/KeyboardShortcutsForm.svelte'
import VirtualMessageList from './lib/components/message-list/VirtualMessageList.svelte'
import ResizeHandles from './lib/components/ResizeHandles.svelte'
import ToolProfileForm from './lib/components/tool-profiles/ToolProfileForm.svelte'
import McpServerForm from './lib/mcp/McpServerForm.svelte'
import PreviewHost from './lib/preview/PreviewHost.svelte'
import { setPreviewContext } from './lib/preview/preview-context'
import { createPreviewController } from './lib/preview/preview-controller.svelte'
import {
  getAccountPreferences,
  getThread,
  listAgents,
  listAgentTasks,
  listGardens,
  listMcpServers,
  listThreads,
  listToolProfiles,
  markThreadActivitySeen,
} from './lib/services/api'
import {
  type BrowserAuthSession,
  getAuthSession,
  loginWithPassword,
  logout,
} from './lib/services/auth'
import { getApiTenantId, setApiTenantId } from './lib/services/backend'
import { humanizeErrorMessage } from './lib/services/response-errors'
import { createAppShortcutDefinitions } from './lib/shortcuts/app-shortcuts'
import {
  type ResolvedShortcutBindings,
  resolveShortcutBindings,
} from './lib/shortcuts/default-bindings'
import { createShortcutManager, setShortcutManagerContext } from './lib/shortcuts/shortcut-manager'
import { createBackgroundActivityStore } from './lib/stores/background-activity.svelte'
import { chatStore } from './lib/stores/chat-store.svelte'
import { chatWidth } from './lib/stores/chat-width.svelte'
import {
  createMessageNavigator,
  setMessageNavigatorContext,
} from './lib/stores/message-navigator.svelte'
import { themeStore } from './lib/stores/theme.svelte'
import { typewriter } from './lib/stores/typewriter.svelte'
import { createViewNavigator, setViewStoreContext, viewKey } from './lib/stores/view-store.svelte'
import { createShortcutLayerStack, setShortcutLayerStackContext } from './lib/ui/layer-stack'

let isSafari = $state(false)
let pinToBottomRequest = $state(0)
let initialHydrationPending = $state(true)
let authCheckPending = $state(true)
let showConnectingScreen = $state(false)
let authError = $state<string | null>(null)
let authSession = $state<BrowserAuthSession | null>(null)
let loginEmail = $state('')
let loginPassword = $state('')
let loginPending = $state(false)
let logoutPending = $state(false)
let tenantChangePending = $state(false)
let selectedTenantId = $state<string | null>(getApiTenantId())
let shortcutBindings = $state<ResolvedShortcutBindings>(resolveShortcutBindings({}))

chatStore.primeFromPersistedState()

const shortcutLayerStack = setShortcutLayerStackContext(createShortcutLayerStack())
const messageNavigator = setMessageNavigatorContext(createMessageNavigator())
const previewController = setPreviewContext(createPreviewController())
const backgroundActivity = createBackgroundActivityStore({
  currentThreadId: () => chatStore.threadId,
  sessionId: () =>
    authSession?.auth.kind === 'auth_session' ? authSession.auth.sessionId : selectedTenantId,
})
const paletteStore = setPaletteStoreContext(
  createPaletteStore({
    layerStack: shortcutLayerStack,
  }),
)
const viewStore = setViewStoreContext(
  createViewNavigator(
    (options) =>
      new Promise<boolean>((resolve) => {
        paletteStore.openWith(
          createConfirmProvider({
            cancelLabel: options.cancelLabel,
            confirmLabel: options.confirmLabel,
            onCancel: () => resolve(false),
            onConfirm: () => resolve(true),
            title: options.title,
          }),
        )
      }),
  ),
)
const conversationProvider = createConversationProvider({
  currentThreadId: () => chatStore.threadId,
  listThreads,
  onSwitchThread: async (thread) => {
    if (!(await viewStore.requestReplace({ kind: 'chat' }))) {
      return
    }
    await chatStore.switchToThread(thread)
  },
})
const workspaceProvider = createWorkspaceProvider({
  currentTenantId: () => selectedTenantId,
  getMemberships: () => authSession?.memberships ?? [],
  onSwitchTenant: async (tenantId) => {
    await handleTenantSelect(tenantId)
  },
})
const agentBrowserProvider = createAgentBrowserProvider({
  listAgents,
  onEditAgent: (agent) => {
    viewStore.push({ kind: 'agent-form', agentId: agent.id })
  },
  onCreateNew: () => {
    viewStore.push({ kind: 'agent-form' })
  },
})
const mcpBrowserProvider = createMcpBrowserProvider({
  listMcpServers,
  onEditServer: (entry) => {
    viewStore.push({ kind: 'mcp-form', serverId: entry.id })
  },
  onConnectNew: () => {
    viewStore.push({ kind: 'mcp-form' })
  },
  onRefreshServer: () => {},
  onDeleteServer: () => {},
  onAuthorizeServer: () => {},
  onOpenTools: (entry) => {
    viewStore.push({ kind: 'mcp-form', serverId: entry.id })
  },
})
const gardenBrowserProvider = createGardenBrowserProvider({
  listGardens,
  onCreateNew: () => {
    viewStore.push({ kind: 'garden-form' })
  },
  onEditSite: (site) => {
    viewStore.push({ kind: 'garden-form', gardenSiteId: site.id })
  },
  onOpenArchive: () => {
    viewStore.push({ kind: 'garden-archive' })
  },
})
const toolProfileBrowserProvider = createToolProfileBrowserProvider({
  listToolProfiles,
  onCreateNew: () => {
    viewStore.push({ kind: 'tool-profile-form' })
  },
  onEditProfile: (profile) => {
    viewStore.push({ kind: 'tool-profile-form', toolProfileId: profile.id })
  },
})
const agentTaskBrowserProvider = createAgentTaskBrowserProvider({
  listAgentTasks: () => listAgentTasks(),
  onCreateNew: () => {
    viewStore.push({ kind: 'agent-task-form' })
  },
  onEditTask: (task) => {
    viewStore.push({ kind: 'agent-task-form', taskId: task.id })
  },
})
const openThreadById = (threadId: string): void => {
  void (async () => {
    if (!(await viewStore.requestReplace({ kind: 'chat' }))) {
      return
    }
    try {
      const thread = await getThread(threadId as Parameters<typeof getThread>[0])
      await chatStore.switchToThread(thread)
    } catch {
      // Thread may not exist yet or was deleted — stay on chat.
    }
  })()
}
const appCommands = setAppCommandsContext(
  createAppCommands({
    canOpenAgentPanel: () => Boolean(authSession && selectedTenantId),
    canOpenManageGardens: () => Boolean(authSession && selectedTenantId),
    canOpenManageAgentTasks: () => Boolean(authSession && selectedTenantId),
    canOpenConversationPicker: () => Boolean(authSession && selectedTenantId),
    canOpenWorkspacePicker: () =>
      Boolean(authSession && authSession.memberships.length > 1) &&
      !loginPending &&
      !logoutPending &&
      !tenantChangePending,
    canUseChatContext: () => viewStore.activeView.kind === 'chat',
    canSignOut: () =>
      Boolean(authSession) && !loginPending && !logoutPending && !tenantChangePending,
    chatStore,
    listThreads,
    requestDeleteConversationConfirmation: ({ currentTitle }) =>
      new Promise<boolean>((resolve) => {
        paletteStore.openWith(
          createConfirmProvider({
            title: `Delete "${currentTitle || 'Untitled'}"?`,
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
          }),
        )
      }),
    requestRenameConversationTitle: ({ currentTitle }) =>
      new Promise<string | null>((resolve) => {
        const provider = createRenameProvider({
          currentTitle,
          getCurrentTitle: () => chatStore.currentThreadTitle?.trim() || currentTitle,
          onRename: (title) => resolve(title),
          onRegenerate: () => {
            void chatStore.regenerateCurrentThreadTitle()
          },
          canRegenerate: () =>
            Boolean(chatStore.threadId) &&
            !chatStore.isLoading &&
            !chatStore.isStreaming &&
            !chatStore.isCancelling &&
            !chatStore.isWaiting &&
            !chatStore.isThreadNaming,
          isRegenerating: () => chatStore.isThreadNaming,
          onCancel: () => resolve(null),
        })
        paletteStore.openWith(provider)
        paletteStore.setQuery(currentTitle)
      }),
    openConversationPicker: () => {
      paletteStore.openWith(conversationProvider)
    },
    openWorkspacePicker: () => {
      paletteStore.openWith(workspaceProvider)
    },
    openAgentPanel: () => {
      paletteStore.openWith(agentBrowserProvider)
    },
    openNewAgent: () => {
      viewStore.push({ kind: 'agent-form' })
    },
    openConnectMcp: () => {
      viewStore.push({ kind: 'mcp-form' })
    },
    openManageMcp: () => {
      paletteStore.openWith(mcpBrowserProvider)
    },
    openManageGardens: () => {
      paletteStore.openWith(gardenBrowserProvider)
    },
    openNewGarden: () => {
      viewStore.push({ kind: 'garden-form' })
    },
    openManageToolProfiles: () => {
      paletteStore.openWith(toolProfileBrowserProvider)
    },
    openManageAgentTasks: () => {
      paletteStore.openWith(agentTaskBrowserProvider)
    },
    openNewAgentTask: () => {
      viewStore.push({ kind: 'agent-task-form' })
    },
    openKeyboardShortcuts: () => {
      viewStore.push({ kind: 'keyboard-shortcuts' })
    },
    requestPinToBottom: () => {
      pinToBottomRequest += 1
    },
    signOut: async () => {
      await handleLogout()
    },
    theme: themeStore,
    typewriter,
  }),
)
const shortcutManager = setShortcutManagerContext(
  createShortcutManager({
    layerStack: shortcutLayerStack,
  }),
)

const commandsProvider = createCommandsProvider(appCommands, () => shortcutBindings)
const commandItems = $derived(
  createCommandRegistry(appCommands, shortcutBindings).filter(
    (item) => item.surfaces?.includes('slash') ?? true,
  ),
)

$effect(() => {
  if (paletteStore.activeProvider?.id !== 'rename') {
    return
  }

  const nextTitle = chatStore.currentThreadTitle?.trim() ?? ''
  if (!nextTitle || nextTitle === paletteStore.query.trim()) {
    return
  }

  paletteStore.setQuery(nextTitle)
})

$effect(() => {
  const bindings = shortcutBindings
  const unregister = shortcutManager.registerShortcuts(
    createAppShortcutDefinitions({ appCommands, bindings, paletteStore, commandsProvider }),
  )
  return () => {
    unregister()
  }
})

const toDisplayError = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    return humanizeErrorMessage(error.message)
  }

  return fallback
}

const resolvePreferredTenantId = (session: BrowserAuthSession): string | null => {
  const membershipIds = new Set(session.memberships.map((membership) => membership.tenantId))
  const preferredTenantId = getApiTenantId() ?? session.tenantScope?.tenantId ?? null

  if (preferredTenantId && membershipIds.has(preferredTenantId)) {
    return preferredTenantId
  }

  return session.memberships[0]?.tenantId ?? null
}

const refreshShortcutBindings = async (): Promise<void> => {
  try {
    const preferences = await getAccountPreferences()
    shortcutBindings = resolveShortcutBindings(preferences.shortcutBindings)
  } catch {
    // Keep current bindings on failure
  }
}

const shouldRefreshTenantScopedSession = (
  session: BrowserAuthSession,
  previousTenantId: string | null,
  nextTenantId: string | null,
): boolean => {
  if (!nextTenantId) {
    return false
  }

  return previousTenantId !== nextTenantId || session.tenantScope?.tenantId !== nextTenantId
}

const establishAuthenticatedSession = async (
  session: BrowserAuthSession,
  options: { resetChat?: boolean } = {},
): Promise<BrowserAuthSession> => {
  const previousTenantId = getApiTenantId()
  const nextTenantId = resolvePreferredTenantId(session)
  const shouldResetChat =
    options.resetChat === true || (previousTenantId !== null && previousTenantId !== nextTenantId)

  if (shouldResetChat || !nextTenantId) {
    viewStore.resetToChat()
    await chatStore.reset({ clearTargetSelection: true })
    backgroundActivity.reset()
  }

  selectedTenantId = nextTenantId
  setApiTenantId(nextTenantId)

  const resolvedSession = shouldRefreshTenantScopedSession(session, previousTenantId, nextTenantId)
    ? ((await getAuthSession()) ?? session)
    : session
  authSession = resolvedSession
  loginEmail = resolvedSession.account.email ?? loginEmail

  return resolvedSession
}

const bootstrapAuthenticatedWorkspace = async (): Promise<void> => {
  if (!selectedTenantId) {
    return
  }

  backgroundActivity.start()
  await chatStore.hydrate(0)
  await refreshShortcutBindings()
}

const applyAuthenticatedSession = async (
  session: BrowserAuthSession,
  options: { resetChat?: boolean } = {},
): Promise<void> => {
  await establishAuthenticatedSession(session, options)
  await bootstrapAuthenticatedWorkspace()
}

const initializeAuth = async (): Promise<BrowserAuthSession | null> => {
  authError = null
  const session = await getAuthSession()

  if (!session) {
    authSession = null
    selectedTenantId = getApiTenantId()
    return null
  }

  return establishAuthenticatedSession(session)
}

const handleLoginSubmit = async (event: SubmitEvent): Promise<void> => {
  event.preventDefault()

  if (loginPending || logoutPending || tenantChangePending) {
    return
  }

  const email = loginEmail.trim()
  if (!email || !loginPassword.trim()) {
    authError = 'Email and password are required.'
    return
  }

  loginPending = true
  authError = null
  initialHydrationPending = true

  try {
    const session = await loginWithPassword({
      email,
      password: loginPassword,
    })

    loginEmail = email
    loginPassword = ''
    await applyAuthenticatedSession(session, { resetChat: true })
  } catch (error) {
    authError = toDisplayError(error, 'Could not sign in.')
  } finally {
    loginPending = false
    initialHydrationPending = false
  }
}

const handleLogout = async (): Promise<void> => {
  if (logoutPending || loginPending || tenantChangePending) {
    return
  }

  logoutPending = true
  authError = null

  try {
    await logout()
    viewStore.resetToChat()
    loginPassword = ''
    await chatStore.reset({ clearTargetSelection: true })
    setApiTenantId(null)
    selectedTenantId = null
    shortcutBindings = resolveShortcutBindings({})
    backgroundActivity.stop()
    authSession = null
  } catch (error) {
    authError = toDisplayError(error, 'Could not sign out.')
  } finally {
    logoutPending = false
    initialHydrationPending = false
  }
}

const handleTenantSelect = async (tenantId: string): Promise<void> => {
  if (!authSession || !tenantId || tenantId === selectedTenantId) {
    return
  }
  const nextTenantId = tenantId

  tenantChangePending = true
  authError = null
  initialHydrationPending = true

  try {
    viewStore.resetToChat()
    await chatStore.reset({ clearTargetSelection: true })
    selectedTenantId = nextTenantId
    setApiTenantId(nextTenantId)
    backgroundActivity.reset()

    const refreshedSession = await getAuthSession()
    if (!refreshedSession) {
      authSession = null
      return
    }

    authSession = refreshedSession
    await bootstrapAuthenticatedWorkspace()
  } catch (error) {
    authError = toDisplayError(error, 'Could not switch workspace.')
  } finally {
    tenantChangePending = false
    initialHydrationPending = false
  }
}

onMount(() => {
  let disposed = false

  const releaseAuthGate = () => {
    authCheckPending = false
    showConnectingScreen = false
  }

  isSafari = /^((?!chrome|chromium|android|crios|fxios).)*safari/i.test(navigator.userAgent)

  document.documentElement.dataset.browser = isSafari ? 'safari' : 'other'
  const stopShortcutListener = shortcutManager.start()

  const connectingTimer = setTimeout(() => {
    if (!disposed && authCheckPending) {
      showConnectingScreen = true
    }
  }, 300)

  void (async () => {
    try {
      const session = await initializeAuth()
      if (!disposed) {
        releaseAuthGate()
      }

      if (!session || session.memberships.length === 0 || !selectedTenantId) {
        return
      }

      await bootstrapAuthenticatedWorkspace()
    } catch (error) {
      if (!disposed) {
        authError = toDisplayError(error, 'Could not start the app.')
      }
    } finally {
      if (!disposed) {
        releaseAuthGate()
        initialHydrationPending = false
      }
    }
  })()

  return () => {
    disposed = true
    clearTimeout(connectingTimer)
    stopShortcutListener()
    messageNavigator.dispose()
    chatStore.dispose()
    backgroundActivity.stop()
    delete document.documentElement.dataset.browser
  }
})

// Deactivate message navigator when the active thread changes.
$effect(() => {
  chatStore.threadId // subscribe
  messageNavigator.deactivate()
})

$effect(() => {
  const threadId = chatStore.threadId
  backgroundActivity.syncCurrentThread()

  if (!authSession || !threadId) {
    return
  }

  void markThreadActivitySeen(threadId).catch(() => {
    // Swallow — activity-bar visibility should not depend on this succeeding immediately.
  })
})

let previousActiveViewKind = viewStore.activeView.kind

const showBlockingConnectingScreen = $derived(
  shouldShowConnectingWorkspaceScreen({
    authCheckPending,
    authSession,
    selectedTenantId,
    showConnectingScreen,
  }),
)

const showBlankAuthScreen = $derived(
  shouldShowBlankAuthScreen({
    authCheckPending,
    authSession,
    selectedTenantId,
    showConnectingScreen,
  }),
)

const showLoginForm = $derived(
  shouldShowLoginScreen({
    authCheckPending,
    authSession,
    selectedTenantId,
    showConnectingScreen,
  }),
)

const showNoWorkspaceState = $derived(
  shouldShowNoWorkspaceScreen({
    authCheckPending,
    authSession,
    selectedTenantId,
    showConnectingScreen,
  }),
)

const renderMainShell = $derived(
  shouldRenderMainShell({
    authCheckPending,
    authSession,
    selectedTenantId,
    showConnectingScreen,
  }),
)

$effect(() => {
  const nextKind = viewStore.activeView.kind

  if (previousActiveViewKind !== 'chat' && nextKind === 'chat') {
    void tick().then(() => {
      document.querySelector<HTMLElement>('.ProseMirror')?.focus()
    })
  }

  previousActiveViewKind = nextKind
})
</script>

<svelte:head>
  <title>Chat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&family=Lexend+Deca:wght@100..900&family=Lexend:wght@100..900&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="min-h-dvh flex flex-col bg-bg" style:--chat-max-w="{chatWidth.value}px" data-safari={isSafari || undefined}>
  {#if showBlockingConnectingScreen}
    <div class="flex-1 flex items-center justify-center px-6 py-10">
      <div class="w-full max-w-md rounded-xl border border-border bg-surface-0 p-8 shadow-sm">
        <div class="flex items-center gap-3">
          <span class="h-2.5 w-2.5 rounded-full bg-accent animate-pulse"></span>
          <h1 class="text-lg font-semibold text-text-primary font-heading">Connecting to the workspace</h1>
        </div>
        <p class="mt-3 text-sm text-text-secondary">
          Waiting for the API to answer the initial auth check.
        </p>
      </div>
    </div>
  {:else if showBlankAuthScreen}
    <div class="flex-1"></div>
  {:else if showLoginForm}
    <div class="flex-1 flex items-center justify-center px-6 py-10">
      <form
        class="w-full max-w-md rounded-xl border border-border bg-surface-0 p-8 shadow-sm"
        onsubmit={handleLoginSubmit}
      >
        <h1 class="text-2xl font-semibold text-text-primary font-heading">Welcome back</h1>
        <p class="mt-2 text-sm text-text-secondary">
          Sign in to continue to your workspace.
        </p>

        <label class="mt-6 block text-sm font-medium text-text-primary" for="login-email">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          bind:value={loginEmail}
          autocomplete="email"
          class="mt-2 w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
          placeholder="you@example.com"
          required
        />

        <label class="mt-4 block text-sm font-medium text-text-primary" for="login-password">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          bind:value={loginPassword}
          autocomplete="current-password"
          class="mt-2 w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
          placeholder="Enter your password"
          required
        />

        {#if authError}
          <p class="mt-4 rounded-lg border border-danger/15 bg-danger-soft px-4 py-3 text-sm text-danger-text">
            {authError}
          </p>
        {/if}

        <button
          type="submit"
          class="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-text-primary px-4 py-3 text-sm font-medium text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loginPending}
        >
          {loginPending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  {:else if showNoWorkspaceState}
    <div class="flex-1 flex items-center justify-center px-6 py-10">
      <div class="w-full max-w-md rounded-xl border border-border bg-surface-0 p-8 shadow-sm">
        <h1 class="text-2xl font-semibold text-text-primary">
          {authSession?.account.name ?? authSession?.account.email ?? authSession?.account.id}
        </h1>
        <p class="mt-3 text-sm text-text-secondary">
          You're signed in, but you don't have access to any workspace yet. Contact your admin to get added.
        </p>
        {#if authError}
          <p class="mt-4 rounded-lg border border-danger/15 bg-danger-soft px-4 py-3 text-sm text-danger-text">
            {authError}
          </p>
        {/if}
        <button
          type="button"
          class="mt-6 inline-flex items-center justify-center rounded-lg border border-border px-4 py-3 text-sm font-medium text-text-primary transition-colors hover:bg-surface-1"
          onclick={handleLogout}
          disabled={logoutPending}
        >
          {logoutPending ? 'Signing out...' : 'Sign out'}
        </button>
      </div>
    </div>
  {:else if renderMainShell}
    <div class="flex-1 flex flex-col min-h-0 relative">
      {#if authError}
        <div class="px-4 pt-4 md:px-6">
          <p class="rounded-xl border border-danger/15 bg-danger-soft px-3 py-2.5 text-sm text-danger-text">
            {authError}
          </p>
        </div>
      {/if}

      <div class="relative min-h-0 flex-1">
        <div class="absolute inset-0 flex min-h-0 flex-col" class:hidden={viewStore.activeView.kind !== 'chat'}>
          <VirtualMessageList
            messages={chatStore.messages}
            streamPulse={chatStore.streamPulse}
            isLoading={chatStore.isLoading}
            {initialHydrationPending}
            pinToBottomToken={pinToBottomRequest}
          />
        </div>

        {#each viewStore.mountedViews as view (viewKey(view))}
          {#if view.kind !== 'chat'}
            <div class="absolute inset-0 overflow-y-auto" class:hidden={viewKey(view) !== viewKey(viewStore.activeView)}>
              {#if view.kind === 'mcp-form'}
                <McpServerForm serverId={view.serverId} />
              {:else if view.kind === 'agent-form'}
                <AgentForm
                  agentId={view.agentId}
                  currentAccountId={authSession?.account.id ?? null}
                />
              {:else if view.kind === 'agent-task-form'}
                <AgentTaskForm
                  taskId={view.taskId}
                  agentId={view.agentId}
                  onOpenThread={openThreadById}
                />
              {:else if view.kind === 'garden-form'}
                <GardenForm
                  currentAccountId={authSession?.account.id ?? null}
                  gardenSiteId={view.gardenSiteId}
                />
              {:else if view.kind === 'garden-archive'}
                <GardenArchivePanel />
              {:else if view.kind === 'tool-profile-form'}
                <ToolProfileForm toolProfileId={view.toolProfileId} />
              {:else if view.kind === 'keyboard-shortcuts'}
                <KeyboardShortcutsForm
                  bindings={shortcutBindings}
                  onBindingsChanged={(next) => { shortcutBindings = next }}
                />
              {/if}
            </div>
          {/if}
        {/each}
      </div>

      <BackgroundActivityBar
        threads={backgroundActivity.threads}
        onSelect={async (threadId) => {
          void markThreadActivitySeen(threadId).catch(() => {
            // Swallow — navigating to the thread should still proceed.
          })
          if (!(await viewStore.requestReplace({ kind: 'chat' }))) {
            return
          }
          try {
            const thread = await getThread(threadId as any)
            await chatStore.switchToThread(thread)
          } catch {
            // Thread may have been deleted — ignore
          }
        }}
      />

      <div class={viewStore.activeView.kind !== 'chat' ? 'pointer-events-none opacity-30' : ''}>
        <ChatComposer
          {commandItems}
          onPinToBottom={() => {
            pinToBottomRequest += 1
          }}
        />
      </div>

      <PalettePopover />
      <PreviewHost />
      <ResizeHandles />
    </div>
  {:else}
    <div class="flex-1"></div>
  {/if}
</div>
