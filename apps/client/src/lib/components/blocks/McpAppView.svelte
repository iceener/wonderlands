<script lang="ts">
import type { McpUiDisplayMode, McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge'
import {
  AppBridge,
  buildAllowAttribute,
  PostMessageTransport,
} from '@modelcontextprotocol/ext-apps/app-bridge'
import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import type { ToolInteractionBlock } from '@wonderlands/contracts/chat'
import { onDestroy, onMount, tick } from 'svelte'
import { formatStructuredValue } from '../../runtime/format'
import {
  callMcpAppTool,
  fetchAppResourceHtml,
  listMcpAppResources,
  listMcpAppResourceTemplates,
  readMcpAppResource,
} from '../../services/mcp-app-resources'
import { chatStore } from '../../stores/chat-store.svelte'
import { themeStore } from '../../stores/theme.svelte'

let { block }: { block: ToolInteractionBlock } = $props()

const appLabel = $derived(
  block.appsMeta?.resourceUri
    ? decodeURIComponent(block.appsMeta.resourceUri.replace(/^ui:\/\//, '').replace(/\//g, ' / '))
    : block.name.replace(/__/g, ' / ').replace(/_/g, ' '),
)

let loading = $state(true)
let error = $state<string | null>(null)
let iframeHeight = $state(400)
let containerEl = $state<HTMLDivElement | null>(null)
let iframeEl = $state<HTMLIFrameElement | null>(null)

let bridge: AppBridge | null = null
let bridgeInitialized = false
let terminalStateSent = $state<'cancelled' | 'result' | null>(null)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Strip Svelte proxies and other non-cloneable values before crossing the bridge.
const cloneBridgeValue = <TValue>(value: TValue): TValue => {
  const seen = new WeakSet<object>()

  const visit = (current: unknown): unknown => {
    if (current === null) {
      return null
    }

    if (typeof current === 'string' || typeof current === 'boolean') {
      return current
    }

    if (typeof current === 'number') {
      return Number.isFinite(current) ? current : null
    }

    if (typeof current === 'bigint') {
      return current.toString()
    }

    if (
      typeof current === 'undefined' ||
      typeof current === 'function' ||
      typeof current === 'symbol'
    ) {
      return undefined
    }

    if (typeof current !== 'object') {
      return undefined
    }

    if (seen.has(current)) {
      return '[Circular]'
    }

    seen.add(current)

    try {
      if (current instanceof Date) {
        return current.toISOString()
      }

      if (current instanceof URL) {
        return current.toString()
      }

      if (current instanceof Error) {
        return {
          ...(typeof current.stack === 'string' ? { stack: current.stack } : {}),
          message: current.message,
          name: current.name,
        }
      }

      if (Array.isArray(current)) {
        return current.map((entry) => {
          const sanitized = visit(entry)
          return sanitized === undefined ? null : sanitized
        })
      }

      if (current instanceof Map) {
        return Array.from(current.entries()).map(([key, entry]) => [
          String(key),
          visit(entry) ?? null,
        ])
      }

      if (current instanceof Set) {
        return Array.from(current.values()).map((entry) => visit(entry) ?? null)
      }

      const sanitizedRecord: Record<string, unknown> = {}

      for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
        const sanitized = visit(entry)
        if (sanitized !== undefined) {
          sanitizedRecord[key] = sanitized
        }
      }

      return sanitizedRecord
    } finally {
      seen.delete(current)
    }
  }

  return visit(value) as TValue
}

const allowAttribute = $derived(
  block.appsMeta
    ? buildAllowAttribute(block.appsMeta.permissions as Parameters<typeof buildAllowAttribute>[0])
    : '',
)

const extractErrorReason = (value: unknown): string => {
  if (isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string') {
    return value.error.message
  }

  const formatted = value == null ? '' : formatStructuredValue(value)
  return formatted.length > 0 ? formatted : 'Tool execution failed'
}

const normalizeToolContent = (value: unknown): CallToolResult['content'] | null => {
  if (!Array.isArray(value)) {
    return null
  }

  const normalized: CallToolResult['content'] = []

  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== 'string') {
      continue
    }

    if (item.type === 'text' && typeof item.text === 'string') {
      normalized.push({
        text: item.text,
        type: 'text',
      })
      continue
    }

    if (
      item.type === 'resource' &&
      isRecord(item.resource) &&
      typeof item.resource.uri === 'string'
    ) {
      if (typeof item.resource.text === 'string') {
        normalized.push({
          resource: {
            ...(typeof item.resource.mimeType === 'string'
              ? { mimeType: item.resource.mimeType }
              : {}),
            text: item.resource.text,
            uri: item.resource.uri,
          },
          type: 'resource',
        })
        continue
      }

      if (typeof item.resource.blob === 'string') {
        normalized.push({
          resource: {
            ...(typeof item.resource.mimeType === 'string'
              ? { mimeType: item.resource.mimeType }
              : {}),
            blob: item.resource.blob,
            uri: item.resource.uri,
          },
          type: 'resource',
        })
      }
      continue
    }

    if (
      item.type === 'resource_link' &&
      typeof item.name === 'string' &&
      typeof item.uri === 'string'
    ) {
      normalized.push({
        ...(typeof item.description === 'string' ? { description: item.description } : {}),
        ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
        name: item.name,
        ...(typeof item.title === 'string' ? { title: item.title } : {}),
        type: 'resource_link',
        uri: item.uri,
      })
    }
  }

  return normalized.length > 0 ? normalized : null
}

const toCallToolResult = (value: unknown): CallToolResult => {
  if (isRecord(value)) {
    const content = normalizeToolContent(value.content)
    const structuredContent = isRecord(value.structuredContent)
      ? value.structuredContent
      : undefined
    const rawMeta = isRecord(value._meta)
      ? value._meta
      : isRecord(value.meta)
        ? value.meta
        : undefined
    const isError = value.isError === true || value.ok === false

    if (content) {
      return {
        content,
        ...(isError ? { isError: true } : {}),
        ...(rawMeta ? { _meta: rawMeta } : {}),
        ...(structuredContent ? { structuredContent } : {}),
      }
    }
  }

  const fallbackText = value == null ? '' : formatStructuredValue(value)

  return {
    content: [
      {
        text: fallbackText,
        type: 'text',
      },
    ],
    ...(isRecord(value) && value.ok === false ? { isError: true } : {}),
  }
}

const extractMessageText = (content: ContentBlock[]): string | null => {
  const textBlocks = content.filter(
    (item): item is Extract<ContentBlock, { type: 'text' }> =>
      item.type === 'text' && typeof item.text === 'string',
  )

  if (textBlocks.length !== content.length) {
    return null
  }

  const text = textBlocks
    .map((item) => item.text.trim())
    .filter((item) => item.length > 0)
    .join('\n\n')

  return text.length > 0 ? text : null
}

const buildHostContext = (): McpUiHostContext => {
  const maxWidth =
    containerEl && containerEl.clientWidth > 0 ? Math.round(containerEl.clientWidth) : 960
  const availableDisplayModes: McpUiDisplayMode[] = ['inline']

  return {
    availableDisplayModes,
    containerDimensions: {
      maxHeight: Math.max(iframeHeight, 400),
      maxWidth,
    },
    displayMode: 'inline' as const,
    locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
    platform: 'web' as const,
    theme: themeStore.isDark ? ('dark' as const) : ('light' as const),
    timeZone:
      typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '05_04_ui',
  }
}

const syncHostContext = () => {
  if (!bridge || !bridgeInitialized) {
    return
  }

  bridge.setHostContext(buildHostContext())
}

const maybeSendTerminalState = () => {
  if (!bridge || !bridgeInitialized || terminalStateSent) {
    return
  }

  if (block.status === 'complete' && block.output !== undefined) {
    void bridge.sendToolResult(cloneBridgeValue(toCallToolResult(block.output)))
    terminalStateSent = 'result'
    return
  }

  if (block.status === 'error') {
    void bridge.sendToolCancelled({
      reason: extractErrorReason(block.output),
    })
    terminalStateSent = 'cancelled'
  }
}

$effect(() => {
  void block.status
  void block.output
  maybeSendTerminalState()
})

$effect(() => {
  void themeStore.isDark
  void iframeHeight
  syncHostContext()
})

onMount(() => {
  let destroyed = false
  let resizeObserver: ResizeObserver | null = null

  const initialize = async () => {
    const appsMeta = block.appsMeta

    if (!appsMeta) {
      error = 'MCP app metadata is missing for this tool.'
      loading = false
      return
    }

    try {
      const html = await fetchAppResourceHtml({
        toolName: block.name,
        uri: appsMeta.resourceUri,
      })

      await tick()

      if (!iframeEl) {
        throw new Error('Failed to create the app iframe')
      }

      const contentWindow = iframeEl.contentWindow

      if (!contentWindow) {
        throw new Error('Failed to access the iframe window')
      }

      const nextBridge = new AppBridge(
        null,
        { name: '05_04_ui', version: '1.0.0' },
        {
          logging: {},
          message: { text: {} },
          openLinks: {},
          sandbox: {
            ...(appsMeta.csp ? { csp: appsMeta.csp } : {}),
            ...(appsMeta.permissions ? { permissions: appsMeta.permissions } : {}),
          },
          serverResources: {},
          serverTools: {},
        },
        {
          hostContext: buildHostContext(),
        },
      )

      nextBridge.onmessage = async ({ content, role }) => {
        if (role !== 'user') {
          return { isError: true }
        }

        const text = extractMessageText(content)

        if (
          !text ||
          chatStore.isLoading ||
          chatStore.isStreaming ||
          (chatStore.isWaiting && !chatStore.canReplyToPendingWait)
        ) {
          return { isError: true }
        }

        try {
          await chatStore.submit(text)
          return {}
        } catch {
          return { isError: true }
        }
      }

      nextBridge.onopenlink = async ({ url }) => {
        try {
          const targetUrl = new URL(url)

          if (!['http:', 'https:'].includes(targetUrl.protocol)) {
            return { isError: true }
          }

          const openedWindow = window.open(targetUrl.toString(), '_blank', 'noopener,noreferrer')
          return openedWindow ? {} : { isError: true }
        } catch {
          return { isError: true }
        }
      }

      nextBridge.onloggingmessage = (params) => {
        console.info('[McpAppView]', params)
      }

      nextBridge.oncalltool = async (params) =>
        callMcpAppTool({
          arguments:
            params.arguments &&
            typeof params.arguments === 'object' &&
            !Array.isArray(params.arguments)
              ? cloneBridgeValue(params.arguments)
              : null,
          name: params.name,
          toolName: block.name,
        })

      nextBridge.onreadresource = async (params) =>
        readMcpAppResource({
          toolName: block.name,
          uri: params.uri,
        })

      nextBridge.onlistresources = async (params) =>
        listMcpAppResources({
          ...(params?.cursor ? { cursor: params.cursor } : {}),
          toolName: block.name,
        })

      nextBridge.onlistresourcetemplates = async (params) =>
        listMcpAppResourceTemplates({
          ...(params?.cursor ? { cursor: params.cursor } : {}),
          toolName: block.name,
        })

      nextBridge.onsizechange = ({ height }) => {
        if (height != null) {
          iframeHeight = height
        }
      }

      nextBridge.oninitialized = () => {
        bridgeInitialized = true
        loading = false
        nextBridge.sendToolInput({
          arguments: block.args ? cloneBridgeValue(block.args) : undefined,
        })
        syncHostContext()
        maybeSendTerminalState()
      }

      bridge = nextBridge
      await nextBridge.connect(new PostMessageTransport(contentWindow, contentWindow))

      if (destroyed) {
        return
      }

      iframeEl.srcdoc = html

      if (typeof ResizeObserver !== 'undefined' && containerEl) {
        resizeObserver = new ResizeObserver(() => {
          syncHostContext()
        })
        resizeObserver.observe(containerEl)
      }
    } catch (fetchError) {
      console.error('[McpAppView] initialization failed', fetchError)
      error = fetchError instanceof Error ? fetchError.message : 'Failed to load app resource'
      loading = false
    }
  }

  void initialize()

  return () => {
    destroyed = true
    resizeObserver?.disconnect()
  }
})

onDestroy(() => {
  const activeBridge = bridge
  bridge = null

  if (activeBridge) {
    void activeBridge.teardownResource({}).catch(() => {})
    void activeBridge.close().catch(() => {})
  }
})
</script>

<div class="mcp-app-view">
  {#if error}
    <div class="text-[12px] text-danger-text py-2 px-3 rounded-md bg-danger/6 border border-danger/15">
      {error}
    </div>
  {:else}
    <div class="flex items-center gap-2 py-1">
      <span class="text-[11px] text-text-tertiary truncate">{appLabel}</span>
      {#if loading}
        <span class="caret-blink shrink-0" style="width:2px;height:10px;" aria-hidden="true"></span>
      {/if}
    </div>
    <div
      bind:this={containerEl}
      class="relative w-full overflow-hidden"
      style="height: {iframeHeight}px;"
    >
      <iframe
        bind:this={iframeEl}
        title={`MCP app view for ${block.name}`}
        sandbox="allow-scripts allow-forms"
        allow={allowAttribute || undefined}
        class:invisible={loading}
        class="block w-full border-0"
        style="height: {iframeHeight}px;"
      ></iframe>

      {#if loading}
        <div class="absolute inset-0 flex items-center justify-center" aria-label="Loading app view" role="status">
          <span class="caret-blink shrink-0" aria-hidden="true"></span>
          <span class="ml-2 text-[12px] text-text-tertiary">Loading app view...</span>
        </div>
      {/if}
    </div>
  {/if}
</div>
