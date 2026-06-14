<script lang="ts">
import { onDestroy, onMount, tick } from 'svelte'
import {
  assignMcpTool,
  type BackendMcpServer,
  type BackendMcpServerSnapshot,
  type BackendMcpServerTool,
  type BeginMcpServerAuthorizationResult,
  beginMcpServerAuthorization,
  type CreateMcpServerInput,
  createMcpServer,
  createToolProfile,
  deleteMcpServer,
  getAccountPreferences,
  getMcpServerTools,
  refreshMcpServer,
  updateAccountPreferences,
  updateMcpServer,
} from '../services/api'
import { toApiUrl } from '../services/backend'
import { humanizeErrorMessage } from '../services/response-errors'
import { getViewStoreContext, viewKey } from '../stores/view-store.svelte'
import ActionButton from '../ui/ActionButton.svelte'
import AlertBanner from '../ui/AlertBanner.svelte'
import DynamicRows from '../ui/DynamicRows.svelte'
import FieldInput from '../ui/FieldInput.svelte'
import SectionCard from '../ui/SectionCard.svelte'
import SegmentControl from '../ui/SegmentControl.svelte'
import StatusBadge from '../ui/StatusBadge.svelte'
import { scrollFormViewToTop } from '../utils/scroll-form-view'
import {
  getAutoRenamedLabel,
  isDuplicateMcpLabelConflict,
  serializeArgumentRows,
  serializeKeyValueRows,
} from './connect-form'

interface Props {
  serverId?: string
}

interface ArgumentRow {
  id: string
  value: string
}
interface KeyValueRow {
  id: string
  key: string
  value: string
}

let { serverId }: Props = $props()

const handleKeydown = (event: KeyboardEvent) => {
  if (!isActiveView()) {
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    void requestClose()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void saveAndClose()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    void persistServer()
  }
}
const viewStore = getViewStoreContext()
const getFormView = () => ({ kind: 'mcp-form' as const, ...(serverId ? { serverId } : {}) })

type TransportKind = CreateMcpServerInput['kind']
type HttpAuthKind = 'none' | 'bearer' | 'oauth_authorization_code'
type AuthorizationPopupOutcome = 'authorized' | 'closed'
const ASSISTANT_TOOL_ACCESS_LABEL = 'assistant tool profile'

let nextRowId = 0
const rid = (prefix: string): string => `${prefix}_${++nextRowId}`
const mkArg = (value = ''): ArgumentRow => ({ id: rid('arg'), value })
const mkKv = (prefix: 'env' | 'header', key = '', value = ''): KeyValueRow => ({
  id: rid(prefix),
  key,
  value,
})

const toArgRows = (args: unknown): ArgumentRow[] =>
  Array.isArray(args) && args.length > 0
    ? args.filter((v): v is string => typeof v === 'string').map((v) => mkArg(v))
    : [mkArg()]

const toKvRows = (prefix: 'env' | 'header', value: unknown): KeyValueRow[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [mkKv(prefix)]
  const entries = Object.entries(value).filter(
    (e): e is [string, string] => typeof e[1] === 'string',
  )
  return entries.length > 0 ? entries.map(([k, v]) => mkKv(prefix, k, v)) : [mkKv(prefix)]
}

const getAuthConfig = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const auth = (value as Record<string, unknown>).auth
  return auth && typeof auth === 'object' && !Array.isArray(auth)
    ? (auth as Record<string, unknown>)
    : null
}

const getHttpAuthKindFromConfig = (value: unknown): HttpAuthKind => {
  const auth = getAuthConfig(value)
  return auth?.kind === 'bearer' || auth?.kind === 'oauth_authorization_code' ? auth.kind : 'none'
}

let labelInput: HTMLInputElement | null = $state(null)
let formRoot: HTMLElement | undefined = $state()

let transport = $state<TransportKind>('streamable_http')
let label = $state('')
let url = $state('')
let command = $state('')
let cwd = $state('')
let argumentRows = $state<ArgumentRow[]>([mkArg()])
let envRows = $state<KeyValueRow[]>([mkKv('env')])
let headerRows = $state<KeyValueRow[]>([mkKv('header')])
let httpAuthKind = $state<HttpAuthKind>('none')
let bearerToken = $state('')
let oauthClientId = $state('')
let oauthClientName = $state('')
let oauthClientSecret = $state('')
let oauthScope = $state('')
let oauthResource = $state('')
let oauthResourceMetadataUrl = $state('')
let oauthTokenEndpointAuthMethod = $state('')
let showAdvanced = $state(false)

let server = $state<BackendMcpServer | null>(null)
let snapshot = $state<BackendMcpServerSnapshot | null>(null)
let tools = $state<BackendMcpServerTool[]>([])
let editingServerId = $state<string | null>(null)
let editingDetails = $state(true)
let errorMessage = $state('')
let successMessage = $state('')
let isConnecting = $state(false)
let isRefreshing = $state(false)
let isAuthorizing = $state(false)
let isDeleting = $state(false)
let isCreatingQuickProfile = $state(false)
let assistantToolProfileId = $state<string | null>(null)

/** Snapshot of form-relevant fields taken after the server has been loaded or saved. */
let loadedLabel = $state('')
let loadedTransport = $state<TransportKind>('streamable_http')
let loadedUrl = $state('')
let loadedCommand = $state('')

const anyDirty = $derived.by(() => {
  // Only track dirty state when the user is actively editing details
  if (!editingDetails) return false
  if (!server && !editingServerId) {
    // New server form: dirty if user typed anything meaningful
    return label.trim().length > 0 || url.trim().length > 0 || command.trim().length > 0
  }
  return (
    label !== loadedLabel ||
    transport !== loadedTransport ||
    url !== loadedUrl ||
    command !== loadedCommand
  )
})

const isActiveView = (): boolean => viewKey(viewStore.activeView) === viewKey(getFormView())

let isConfirmingDiscard = $state(false)
let discardTimer: ReturnType<typeof setTimeout> | null = null

const requestClose = (): void => {
  if (!anyDirty) {
    viewStore.pop()
    return
  }
  if (!isConfirmingDiscard) {
    isConfirmingDiscard = true
    discardTimer = setTimeout(() => {
      isConfirmingDiscard = false
    }, 3000)
    return
  }
  if (discardTimer) clearTimeout(discardTimer)
  isConfirmingDiscard = false
  viewStore.pop()
}

const saveAndClose = async (): Promise<void> => {
  if (!editingDetails || !anyDirty) {
    viewStore.pop()
    return
  }

  if (await persistServer()) {
    viewStore.pop()
  }
}

const assignableTools = $derived(tools.filter((tool) => tool.modelVisible))
const isReadOnlyServer = $derived(server?.source === 'static')

const quickCreateAssistantProfile = async () => {
  if (!server || isCreatingQuickProfile) return
  isCreatingQuickProfile = true
  errorMessage = ''
  successMessage = ''

  try {
    const profile = await createToolProfile({ name: 'Assistant Default', scope: 'account_private' })

    for (const tool of assignableTools) {
      await assignMcpTool({
        requiresConfirmation: true,
        runtimeName: tool.runtimeName,
        serverId: server.id,
        toolProfileId: profile.id,
      })
    }

    await updateAccountPreferences({ assistantToolProfileId: profile.id })
    assistantToolProfileId = profile.id
    successMessage = `Created "${profile.name}" with ${assignableTools.length} tool${assignableTools.length === 1 ? '' : 's'} and set as assistant default.`
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not create profile.',
    )
  } finally {
    isCreatingQuickProfile = false
  }
}

const snapshotLoadedState = () => {
  loadedLabel = label
  loadedTransport = transport
  loadedUrl = url
  loadedCommand = command
}

const populateFromServer = (s: BackendMcpServer) => {
  label = s.label
  transport = s.kind
  if (s.kind === 'streamable_http') {
    const auth = getAuthConfig(s.config)
    url = typeof s.config.url === 'string' ? s.config.url : ''
    command = ''
    cwd = ''
    argumentRows = [mkArg()]
    envRows = [mkKv('env')]
    headerRows = toKvRows('header', s.config.headers)
    httpAuthKind = getHttpAuthKindFromConfig(s.config)
    bearerToken = httpAuthKind === 'bearer' && typeof auth?.token === 'string' ? auth.token : ''
    oauthClientId =
      httpAuthKind === 'oauth_authorization_code' && typeof auth?.clientId === 'string'
        ? auth.clientId
        : ''
    oauthClientName =
      httpAuthKind === 'oauth_authorization_code' && typeof auth?.clientName === 'string'
        ? auth.clientName
        : ''
    oauthClientSecret =
      httpAuthKind === 'oauth_authorization_code' && typeof auth?.clientSecret === 'string'
        ? auth.clientSecret
        : ''
    oauthScope =
      httpAuthKind === 'oauth_authorization_code' && typeof auth?.scope === 'string'
        ? auth.scope
        : ''
    oauthResource =
      httpAuthKind === 'oauth_authorization_code' && typeof auth?.resource === 'string'
        ? auth.resource
        : ''
    oauthResourceMetadataUrl =
      httpAuthKind === 'oauth_authorization_code' && typeof auth?.resourceMetadataUrl === 'string'
        ? auth.resourceMetadataUrl
        : ''
    oauthTokenEndpointAuthMethod =
      httpAuthKind === 'oauth_authorization_code' &&
      typeof auth?.tokenEndpointAuthMethod === 'string'
        ? auth.tokenEndpointAuthMethod
        : ''
    showAdvanced = headerRows.some((r) => r.key.trim().length > 0 || r.value.trim().length > 0)
  } else {
    command = typeof s.config.command === 'string' ? s.config.command : ''
    cwd = typeof s.config.cwd === 'string' ? s.config.cwd : ''
    url = ''
    argumentRows = toArgRows(s.config.args)
    envRows = toKvRows('env', s.config.env)
    headerRows = [mkKv('header')]
    httpAuthKind = 'none'
    bearerToken = ''
    oauthClientId = ''
    oauthClientName = ''
    oauthClientSecret = ''
    oauthScope = ''
    oauthResource = ''
    oauthResourceMetadataUrl = ''
    oauthTokenEndpointAuthMethod = ''
    showAdvanced =
      cwd.trim().length > 0 ||
      envRows.some((r) => r.key.trim().length > 0 || r.value.trim().length > 0)
  }
  snapshotLoadedState()
}

const buildServerInput = (): CreateMcpServerInput => {
  const trimmedLabel = label.trim()
  if (!trimmedLabel) throw new Error('Add a name so you can recognize this MCP later.')

  if (transport === 'streamable_http') {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) throw new Error('Add the Streamable HTTP URL.')
    const headers = serializeKeyValueRows(headerRows, 'header')
    const trimmedBearer = bearerToken.trim()
    const auth =
      httpAuthKind === 'bearer'
        ? (() => {
            if (!trimmedBearer) throw new Error('Add the bearer token.')
            return { kind: 'bearer' as const, token: trimmedBearer }
          })()
        : httpAuthKind === 'oauth_authorization_code'
          ? {
              ...(oauthClientId.trim() ? { clientId: oauthClientId.trim() } : {}),
              ...(oauthClientName.trim() ? { clientName: oauthClientName.trim() } : {}),
              ...(oauthClientSecret.trim() ? { clientSecret: oauthClientSecret.trim() } : {}),
              kind: 'oauth_authorization_code' as const,
              ...(oauthResource.trim() ? { resource: oauthResource.trim() } : {}),
              ...(oauthResourceMetadataUrl.trim()
                ? { resourceMetadataUrl: oauthResourceMetadataUrl.trim() }
                : {}),
              ...(oauthScope.trim() ? { scope: oauthScope.trim() } : {}),
              ...(oauthTokenEndpointAuthMethod.trim()
                ? { tokenEndpointAuthMethod: oauthTokenEndpointAuthMethod.trim() }
                : {}),
            }
          : ({ kind: 'none' } as const)
    return {
      config: { auth, ...(Object.keys(headers).length > 0 ? { headers } : {}), url: trimmedUrl },
      kind: 'streamable_http',
      label: trimmedLabel,
    }
  }

  const trimmedCommand = command.trim()
  if (!trimmedCommand) throw new Error('Add the local command or executable path.')
  const args = serializeArgumentRows(argumentRows)
  const env = serializeKeyValueRows(envRows, 'environment')
  return {
    config: {
      ...(args.length > 0 ? { args } : {}),
      command: trimmedCommand,
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    },
    kind: 'stdio',
    label: trimmedLabel,
  }
}

const persistServer = async (): Promise<boolean> => {
  if (isConnecting) return false
  isConnecting = true
  errorMessage = ''
  successMessage = ''
  try {
    const baseInput = buildServerInput()
    const isEditing = editingServerId !== null
    let persisted: Awaited<ReturnType<typeof createMcpServer>> | null = null
    let resolvedLabel = baseInput.label

    if (editingServerId) {
      persisted = await updateMcpServer(editingServerId, baseInput)
    } else {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidateLabel = getAutoRenamedLabel(baseInput.label, attempt)
        try {
          persisted = await createMcpServer({ ...baseInput, label: candidateLabel })
          resolvedLabel = candidateLabel
          break
        } catch (error) {
          if (
            !isDuplicateMcpLabelConflict(error instanceof Error ? error.message : '') ||
            attempt === 9
          )
            throw error
        }
      }
    }

    if (!persisted) throw new Error('Could not save this MCP server.')
    const discovered = await getMcpServerTools(persisted.server.id)
    server = persisted.server
    snapshot = persisted.snapshot
    tools = discovered.tools
    editingServerId = persisted.server.id
    editingDetails = false
    label = resolvedLabel
    snapshotLoadedState()
    successMessage = `${isEditing ? 'Saved' : 'Connected'} and discovered ${discovered.tools.length} tool${discovered.tools.length === 1 ? '' : 's'}.`
    return true
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not save this MCP server.',
    )
    return false
  } finally {
    isConnecting = false
  }
}

const snapshotSuggestsOAuth = (s: BackendMcpServerSnapshot | null): boolean =>
  Boolean(
    s &&
      (s.status === 'authorization_required' ||
        (s.status === 'degraded' && /unauthorized|401/i.test(s.lastError ?? ''))),
  )

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const serverCanAuthorize = $derived(
  Boolean(server && server.kind === 'streamable_http' && snapshotSuggestsOAuth(snapshot)),
)

const syncServerState = async (
  targetServerId: string,
): Promise<{
  server: BackendMcpServer
  snapshot: BackendMcpServerSnapshot
  tools: BackendMcpServerTool[]
}> => {
  const nextSnapshot = await refreshMcpServer(targetServerId)
  const discovered = await getMcpServerTools(targetServerId)

  server = discovered.server
  snapshot = nextSnapshot
  tools = discovered.tools

  return {
    server: discovered.server,
    snapshot: nextSnapshot,
    tools: discovered.tools,
  }
}

const refreshServerState = async () => {
  if (!server || isRefreshing) return
  isRefreshing = true
  errorMessage = ''
  successMessage = ''
  try {
    const nextState = await syncServerState(server.id)
    successMessage = `Refreshed — ${nextState.tools.length} tool${nextState.tools.length === 1 ? '' : 's'} discovered.`
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not refresh.',
    )
  } finally {
    isRefreshing = false
  }
}

const awaitAuthorizationPopup = (
  serverId: string,
  started: Extract<BeginMcpServerAuthorizationResult, { kind: 'redirect' }>,
): Promise<AuthorizationPopupOutcome> => {
  const expectedOrigin = new URL(toApiUrl('/'), window.location.origin).origin
  const popup = window.open(
    started.authorizationUrl,
    `mcp-oauth-${serverId}`,
    'popup=yes,width=560,height=720',
  )

  if (!popup) {
    throw new Error(
      'Your browser blocked the authorization popup. Allow popups for this site in your browser settings and try again.',
    )
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(closePoll)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) return

      const payload = event.data as
        | {
            type?: string
            serverId?: string
            status?: 'authorized' | 'error'
            message?: string
          }
        | undefined

      if (!payload || payload.type !== '05_04_api.mcp_oauth' || payload.serverId !== serverId) {
        return
      }

      cleanup()

      if (payload.status === 'authorized') {
        resolve('authorized')
        return
      }

      reject(new Error(payload.message ?? 'Authentication failed.'))
    }

    const closePoll = window.setInterval(() => {
      if (popup.closed) {
        cleanup()
        resolve('closed')
      }
    }, 400)

    window.addEventListener('message', onMessage)
  })
}

const syncServerStateAfterAuthorization = async (
  targetServerId: string,
  popupOutcome: AuthorizationPopupOutcome | null,
) => {
  let nextState = await syncServerState(targetServerId)

  if (popupOutcome === 'closed') {
    for (let attempt = 0; attempt < 5 && snapshotSuggestsOAuth(nextState.snapshot); attempt += 1) {
      await wait(250)
      nextState = await syncServerState(targetServerId)
    }
  }

  return nextState
}

const authorizeServer = async () => {
  if (!server || isAuthorizing) return
  isAuthorizing = true
  errorMessage = ''
  successMessage = ''
  const currentServerId = server.id
  const currentServerLabel = server.label
  try {
    let popupOutcome: AuthorizationPopupOutcome | null = null
    const started = await beginMcpServerAuthorization(currentServerId, {
      ...(typeof window !== 'undefined' ? { responseOrigin: window.location.origin } : {}),
    })

    if (started.kind === 'redirect') {
      popupOutcome = await awaitAuthorizationPopup(currentServerId, started)
    } else {
      snapshot = started.snapshot
    }

    const nextState = await syncServerStateAfterAuthorization(currentServerId, popupOutcome)
    if (nextState.snapshot.status !== 'ready') {
      throw new Error(
        snapshotSuggestsOAuth(nextState.snapshot) && popupOutcome === 'closed'
          ? 'The authorization window closed before the OAuth flow completed.'
          : (nextState.snapshot.lastError ??
              `Authentication failed for "${nextState.server.label}".`),
      )
    }

    successMessage =
      nextState.tools.length > 0
        ? `Authentication completed for "${nextState.server.label}" and discovered ${nextState.tools.length} tool${nextState.tools.length === 1 ? '' : 's'}.`
        : `Authentication completed for "${nextState.server.label}".`
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : `Authentication failed for "${currentServerLabel}".`,
    )
  } finally {
    isAuthorizing = false
  }
}

const deleteCurrentServer = async () => {
  if (!server || isDeleting) return
  if (
    typeof window !== 'undefined' &&
    !window.confirm(`Remove "${server.label}"? This also removes cached tools and assignments.`)
  )
    return
  isDeleting = true
  errorMessage = ''
  try {
    await deleteMcpServer(server.id)
    viewStore.pop()
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not remove.',
    )
  } finally {
    isDeleting = false
  }
}

onMount(async () => {
  window.addEventListener('keydown', handleKeydown)
  viewStore.registerDirtyGuard(getFormView(), () => anyDirty)
  void tick().then(() => {
    scrollFormViewToTop(formRoot)
  })

  try {
    const preferences = await getAccountPreferences()
    assistantToolProfileId = preferences.assistantToolProfileId
  } catch {
    assistantToolProfileId = null
  }

  if (serverId) {
    try {
      const discovered = await syncServerState(serverId!)
      editingServerId = serverId!
      editingDetails = false
      populateFromServer(discovered.server)
    } catch (error) {
      errorMessage = humanizeErrorMessage(
        error instanceof Error ? error.message : 'Could not load this MCP server.',
      )
    }
  } else {
    editingDetails = true
    await tick()
    labelInput?.focus()
  }

  await tick()
  scrollFormViewToTop(formRoot)
})

onDestroy(() => {
  if (discardTimer) clearTimeout(discardTimer)
  window.removeEventListener('keydown', handleKeydown)
  viewStore.clearDirtyGuard(getFormView())
})
</script>

<div class="mx-auto w-full px-6 py-8" style="max-width: var(--chat-max-w, 42rem)" bind:this={formRoot}>
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 class="text-[16px] font-semibold text-text-primary">
        {editingDetails && !server ? 'Connect MCP' : server?.label ?? 'MCP Server'}
      </h2>
      <p class="mt-1 text-[13px] text-text-secondary">
        {editingDetails
          ? 'Configure the MCP server connection.'
          : 'Manage connection and discovery.'}
      </p>
    </div>
    <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {#if server && !editingDetails}
        {#if serverCanAuthorize}
          <ActionButton variant="accent" disabled={isAuthorizing} onclick={() => { void authorizeServer() }}>
            {isAuthorizing ? 'Authorizing…' : 'Authorize'}
          </ActionButton>
        {/if}
        {#if server.source !== 'static'}
          <ActionButton disabled={isRefreshing} onclick={() => { void refreshServerState() }}>
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </ActionButton>
          <ActionButton onclick={() => { editingDetails = true; populateFromServer(server!); void tick().then(() => labelInput?.focus()) }}>Edit</ActionButton>
          <ActionButton variant="danger" disabled={isDeleting} onclick={() => { void deleteCurrentServer() }}>
            {isDeleting ? 'Removing…' : 'Remove'}
          </ActionButton>
        {/if}
      {/if}
      <ActionButton variant={isConfirmingDiscard ? 'danger' : 'secondary'} onclick={() => { requestClose() }}>
        {isConfirmingDiscard ? 'Discard' : viewStore.backLabel ?? 'Back to Chat'}
      </ActionButton>
      <ActionButton variant="primary" disabled={isConnecting} onclick={() => { void saveAndClose() }}>
        {isConnecting ? 'Saving…' : 'Save & Close'}
      </ActionButton>
    </div>
  </div>

  {#if errorMessage}
    <AlertBanner variant="error" message={errorMessage} ondismiss={() => { errorMessage = '' }} />
  {/if}
  {#if successMessage}
    <AlertBanner variant="success" message={successMessage} ondismiss={() => { successMessage = '' }} />
  {/if}

  {#if editingDetails || !server}
    <form class="space-y-6" onsubmit={(e) => { e.preventDefault(); void persistServer() }}>
      <SegmentControl
        options={[
          { value: 'streamable_http', label: 'Streamable HTTP', description: 'Remote MCP over URL' },
          { value: 'stdio', label: 'Local stdio', description: 'Spawn a local process' },
        ]}
        value={transport}
        onchange={(v) => { transport = v }}
      />

      <FieldInput label="Name" value={label} placeholder="Research MCP" oninput={(v) => { label = v }} bindRef={(el) => { labelInput = el }} />

      {#if transport === 'streamable_http'}
        <FieldInput label="URL" type="url" value={url} placeholder="https://example.com/mcp" oninput={(v) => { url = v }} />

        <SectionCard title="Authentication" description="Start with Automatic. Hosted MCPs like Gmail should advertise OAuth and prompt you after save.">
          <SegmentControl
            options={[
              { value: 'none', label: 'Automatic' },
              { value: 'bearer', label: 'Bearer token' },
              { value: 'oauth_authorization_code', label: 'Advanced OAuth' },
            ]}
            value={httpAuthKind}
            onchange={(v) => { httpAuthKind = v }}
          />
          {#if httpAuthKind === 'bearer'}
            <div class="mt-3">
              <FieldInput label="Bearer Token" type="password" value={bearerToken} placeholder="sk-..." oninput={(v) => { bearerToken = v }} />
            </div>
          {:else if httpAuthKind === 'oauth_authorization_code'}
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <FieldInput label="Client ID" value={oauthClientId} placeholder="Optional" oninput={(v) => { oauthClientId = v }} />
              <FieldInput label="Client Name" value={oauthClientName} placeholder="Dynamic registration" oninput={(v) => { oauthClientName = v }} />
              <FieldInput label="Client Secret" type="password" value={oauthClientSecret} placeholder="Confidential client only" oninput={(v) => { oauthClientSecret = v }} />
              <FieldInput label="Scope" value={oauthScope} placeholder="offline_access openid" oninput={(v) => { oauthScope = v }} />
              <FieldInput label="Resource" value={oauthResource} placeholder="Optional audience" oninput={(v) => { oauthResource = v }} />
              <FieldInput label="Token Auth Method" value={oauthTokenEndpointAuthMethod} placeholder="none or client_secret_basic" oninput={(v) => { oauthTokenEndpointAuthMethod = v }} />
            </div>
            <div class="mt-3">
              <FieldInput label="Resource Metadata URL" type="url" value={oauthResourceMetadataUrl} placeholder="https://example.com/.well-known/oauth-protected-resource" oninput={(v) => { oauthResourceMetadataUrl = v }} />
            </div>
          {/if}
        </SectionCard>
      {:else}
        <FieldInput label="Command or Path" value={command} placeholder="node" oninput={(v) => { command = v }} />

        <SectionCard title="Arguments" description="Each row becomes one argv entry. No shell parsing.">
          <DynamicRows
            mode="text"
            rows={argumentRows}
            placeholder="--import"
            onupdate={(id, value) => { argumentRows = argumentRows.map((r) => r.id === id ? { ...r, value } : r) }}
            onadd={() => { argumentRows = [...argumentRows, mkArg()] }}
            onremove={(id) => { argumentRows = argumentRows.length === 1 ? [mkArg()] : argumentRows.filter((r) => r.id !== id) }}
            addLabel="Add Argument"
          />
        </SectionCard>
      {/if}

      {#if showAdvanced || transport === 'streamable_http'}
        <button type="button" class="flex w-full items-center justify-between rounded-lg border border-border bg-surface-1/70 px-3 py-2.5 text-left text-[13px] text-text-secondary transition-colors hover:text-text-primary" onclick={() => { showAdvanced = !showAdvanced }}>
          <span class="font-medium">Advanced</span>
          <span class="text-[12px] text-text-tertiary">{showAdvanced ? 'Hide' : 'Show'}</span>
        </button>
      {/if}

      {#if showAdvanced}
        {#if transport === 'streamable_http'}
          <SectionCard title="Headers" description="Standard request headers for custom integrations.">
            <DynamicRows
              mode="kv"
              rows={headerRows}
              keyPlaceholder="X-Api-Key"
              valuePlaceholder="sk-..."
              onupdatekey={(id, key) => { headerRows = headerRows.map((r) => r.id === id ? { ...r, key } : r) }}
              onupdatevalue={(id, value) => { headerRows = headerRows.map((r) => r.id === id ? { ...r, value } : r) }}
              onadd={() => { headerRows = [...headerRows, mkKv('header')] }}
              onremove={(id) => { headerRows = headerRows.length === 1 ? [mkKv('header')] : headerRows.filter((r) => r.id !== id) }}
              addLabel="Add Header"
            />
          </SectionCard>
        {:else}
          <FieldInput label="Working Directory" value={cwd} placeholder="/Users/me/project" oninput={(v) => { cwd = v }} />
          <SectionCard title="Environment" description="Optional environment variables for the spawned process.">
            <DynamicRows
              mode="kv"
              rows={envRows}
              keyPlaceholder="NODE_ENV"
              valuePlaceholder="development"
              onupdatekey={(id, key) => { envRows = envRows.map((r) => r.id === id ? { ...r, key } : r) }}
              onupdatevalue={(id, value) => { envRows = envRows.map((r) => r.id === id ? { ...r, value } : r) }}
              onadd={() => { envRows = [...envRows, mkKv('env')] }}
              onremove={(id) => { envRows = envRows.length === 1 ? [mkKv('env')] : envRows.filter((r) => r.id !== id) }}
              addLabel="Add Variable"
            />
          </SectionCard>
        {/if}
      {/if}

      <div class="flex items-center justify-end gap-2 border-t border-border pt-4">
        {#if editingServerId}
          <ActionButton onclick={() => { editingDetails = false; populateFromServer(server!) }}>
            Cancel
          </ActionButton>
        {/if}
        <ActionButton variant="primary" type="submit" disabled={isConnecting}>
          {isConnecting ? 'Saving…' : editingServerId ? 'Save and Refresh' : 'Connect and Discover Tools'}
        </ActionButton>
      </div>
    </form>
  {:else}
    <!-- Server detail + tool access -->
    <div class="space-y-6">
      <!-- Connection summary -->
      <SectionCard title="Connection">
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <span class="text-[13px] font-medium text-text-primary">{server.label}</span>
            {#if server.source === 'static'}
              <StatusBadge status="unknown" label="built-in" />
            {/if}
            <StatusBadge
              status={snapshot?.status ?? 'unknown'}
              label={snapshot?.status === 'authorization_required' ? 'needs auth' : snapshot?.status === 'ready' ? 'connected' : snapshot?.status ?? 'unknown'}
            />
          </div>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-tertiary">
            <span>{server.kind === 'streamable_http' ? 'Streamable HTTP' : 'Local stdio'}</span>
            <span aria-hidden="true" class="text-text-tertiary/40">&middot;</span>
            <span>{tools.length} discovered</span>
            <span aria-hidden="true" class="text-text-tertiary/40">&middot;</span>
            <span>{assignableTools.length} available</span>
          </div>

          {#if isAuthorizing}
            <div class="rounded-md border border-accent/20 bg-accent/5 px-3 py-2.5">
              <p class="text-[12px] font-medium text-text-primary">Authorizing…</p>
              <p class="mt-0.5 text-[11px] text-text-tertiary">
                Complete the sign-in in the popup window. This page will update automatically.
              </p>
            </div>
          {:else if serverCanAuthorize}
            <div class="flex items-center justify-between rounded-md border border-border bg-surface-0 px-3 py-2.5">
              <div>
                <p class="text-[12px] font-medium text-text-secondary">Authorization required</p>
                <p class="mt-0.5 text-[11px] text-text-tertiary">Complete OAuth to discover tools.</p>
              </div>
              <ActionButton variant="accent" disabled={isAuthorizing} onclick={() => { void authorizeServer() }}>
                Authorize
              </ActionButton>
            </div>
          {/if}

          {#if snapshot?.lastError && !serverCanAuthorize}
            <p class="text-[11px] text-warning-text">{humanizeErrorMessage(snapshot.lastError)}</p>
          {/if}
        </div>
      </SectionCard>

      {#if !serverCanAuthorize}
        <SectionCard
          title="Tool Access"
          description="MCP servers expose tools. Tool profiles decide which of those tools assistant mode or agents may use."
        >
          {#if !assistantToolProfileId && assignableTools.length > 0}
            <div class="space-y-3">
              <p class="text-[12px] text-text-secondary">
                No tool profile exists yet. Create one to grant these tools to assistant mode.
              </p>
              <ActionButton
                variant="primary"
                disabled={isCreatingQuickProfile}
                onclick={() => { void quickCreateAssistantProfile() }}
              >
                {isCreatingQuickProfile ? 'Creating…' : `Create assistant profile with all ${assignableTools.length} tools`}
              </ActionButton>
            </div>
          {:else}
            <div class="rounded-md border border-border bg-surface-0 px-3 py-3">
              <p class="text-[12px] text-text-secondary">
                Manage MCP grants from a tool profile, not from this server screen.
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <ActionButton
                  disabled={!assistantToolProfileId}
                  onclick={() => {
                    if (assistantToolProfileId) {
                      viewStore.push({
                        kind: 'tool-profile-form',
                        toolProfileId: assistantToolProfileId,
                      })
                    }
                  }}
                >
                  Manage assistant tool profile
                </ActionButton>
                <ActionButton
                  onclick={() => {
                    viewStore.push({ kind: 'tool-profile-form' })
                  }}
                >
                  New Tool Profile
                </ActionButton>
              </div>
            </div>
          {/if}
        </SectionCard>

        <SectionCard
          title="Discovered Tools"
          description={isReadOnlyServer ? 'Built-in tools available to all users.' : 'Preview the tools exposed by this MCP server.'}
        >
          {#if assignableTools.length === 0}
            <p class="py-2 text-center text-[12px] text-text-tertiary">No tools discovered yet.</p>
          {:else}
            <div class="rounded-md border border-border bg-surface-0">
              <div class="border-b border-border px-3 py-2">
                <div class="flex items-center gap-2">
                  <span class="truncate text-[12px] font-medium text-text-primary">{server?.label ?? 'Tools'}</span>
                  <span class="text-[10px] text-text-tertiary">{assignableTools.length} available</span>
                </div>
              </div>
              <div>
                {#each assignableTools as tool}
                  <div class="flex items-center gap-2.5 px-3 py-1.5">
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary/40"></span>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-[11px] text-text-secondary">{tool.title?.trim() || tool.remoteName}</div>
                      {#if tool.description}
                        <div class="truncate text-[10px] text-text-tertiary">{tool.description}</div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </SectionCard>
      {/if}
    </div>
  {/if}
</div>
