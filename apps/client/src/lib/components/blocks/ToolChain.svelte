<script lang="ts">
import type { Block, ToolInteractionBlock } from '@wonderlands/contracts/chat'
import { formatStructuredValue } from '../../runtime/format'
import { toApiUrl } from '../../services/backend'
import { escapeHtml, hljs } from '../../services/markdown/highlight'
import ImageTile from '../ImageTile.svelte'
import type { ChainableBlock } from './render-items'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface ChainImageEntry {
  fileId: string
  name: string
}

const parseChainImageOutput = (block: ChainableBlock): ChainImageEntry[] | null => {
  if (block.type !== 'tool_interaction') return null
  const output = (block as ToolInteractionBlock).output
  if (!isRecord(output) || typeof output.imageCount !== 'number') return null
  if (!Array.isArray(output.images)) return null
  const images: ChainImageEntry[] = []
  for (const img of output.images) {
    if (isRecord(img) && typeof img.fileId === 'string') {
      images.push({
        fileId: img.fileId as string,
        name: typeof img.name === 'string' ? (img.name as string) : 'generated image',
      })
    }
  }
  return images.length > 0 ? images : null
}

let { blocks }: { blocks: ChainableBlock[] } = $props()

const blockLabel = (block: ChainableBlock): string => {
  if (block.type === 'thinking') return block.title || 'reasoning'
  if (block.type === 'web_search') return 'web search'
  return block.name
}

let expanded = $state(false)
let expandedToolId = $state<string | null>(null)

const totalDuration = $derived.by(() => {
  let earliest = Infinity
  let latest = 0
  for (const b of blocks) {
    const created = Date.parse(b.createdAt)
    const finished = 'finishedAt' in b && b.finishedAt != null ? Date.parse(b.finishedAt) : created
    if (Number.isFinite(created) && created < earliest) earliest = created
    if (Number.isFinite(finished) && finished > latest) latest = finished
  }
  if (!Number.isFinite(earliest) || latest <= earliest) return null
  const ms = latest - earliest
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
})

const chainSegments = $derived.by(() => {
  const segs: { name: string; count: number }[] = []
  for (const b of blocks) {
    const label = blockLabel(b)
    const last = segs[segs.length - 1]
    if (last && last.name === label) {
      last.count++
    } else {
      segs.push({ name: label, count: 1 })
    }
  }
  return segs
})

const toolHint = (block: ChainableBlock): string | null => {
  if (block.type === 'thinking') {
    const text = block.content
    if (!text) return null
    return text.length > 60 ? `${text.slice(0, 57)}\u2026` : text
  }
  if (block.type === 'web_search') {
    const q = block.queries?.[0]
    if (q) return q.length > 60 ? `${q.slice(0, 57)}\u2026` : q
    return block.references?.length ? `${block.references.length} references` : null
  }
  if (block.args == null) return null
  const vals = Object.values(block.args)
  const first = vals.find((v): v is string => typeof v === 'string')
  if (first) return first.length > 60 ? `${first.slice(0, 57)}\u2026` : first
  if (vals.length > 0) return `${vals.length} params`
  return null
}

const highlightJson = (text: string): string => {
  if (!text) return ''
  try {
    return hljs.highlight(text, { language: 'json' }).value
  } catch {
    return escapeHtml(text)
  }
}

const highlightCode = (text: string, language: string): string => {
  if (!text) return ''
  try {
    return hljs.highlight(text, { language }).value
  } catch {
    return escapeHtml(text)
  }
}

const extractSandboxScript = (
  block: ChainableBlock,
): { scriptHtml: string; restHtml: string | null } | null => {
  if (block.type !== 'tool_interaction' || !block.name.startsWith('execute')) return null
  const args = block.args
  if (!args) return null
  const source = args.source
  const scriptSource = isRecord(source) ? source : args
  const script = scriptSource.script
  if (typeof script !== 'string') return null
  const kind = (isRecord(source) ? source.kind : (args.kind ?? args.mode)) as string | undefined
  const lang = kind === 'bash' ? 'bash' : 'javascript'
  const rest = { ...args }
  if (isRecord(source)) {
    const { script: _, ...restSource } = source as Record<string, unknown>
    rest.source = restSource
  } else {
    delete rest.script
  }
  const scriptHtml = highlightCode(script, lang)
  const restHtml =
    Object.keys(rest).length > 0 ? highlightJson(JSON.stringify(rest, null, 2)) : null
  return { scriptHtml, restHtml }
}

const toggleTool = (id: string) => {
  expandedToolId = expandedToolId === id ? null : id
}
</script>

<div class="tool-chain-accent">
  <button
    type="button"
    class="tool-chain-header"
    onclick={() => { expanded = !expanded }}
  >
    <div class="tool-chain-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </div>
    <div class="tool-chain-segments">
      {#each chainSegments as seg, i}
        {#if i > 0}<span class="tool-chain-sep">&rarr;</span>{/if}
        <span class="tool-chain-item">{seg.name}{#if seg.count > 1}<span class="tool-chain-mult">&times;{seg.count}</span>{/if}</span>
      {/each}
    </div>
    {#if totalDuration}
      <span class="tool-chain-time">{totalDuration}</span>
    {/if}
    <div class="tool-chain-chevron" class:open={expanded}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
    </div>
  </button>

  <div class="collapsible" class:open={expanded}>
    <div>
      <div class="tool-chain-list">
        {#each blocks as block (block.id)}
          <button
            type="button"
            class="tool-chain-row"
            onclick={() => toggleTool(block.id)}
          >
            <div class="tool-chain-row-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <span class="tool-chain-row-name">{blockLabel(block)}</span>
            {#if toolHint(block)}
              <span class="tool-chain-row-hint">{toolHint(block)}</span>
            {/if}
          </button>
          <div class="collapsible" class:open={expandedToolId === block.id}>
            <div>
              <div class="tool-chain-detail">
                {#if block.type === 'thinking'}
                  <div>
                    <pre class="m-0 text-[12px] leading-relaxed text-text-tertiary font-mono whitespace-pre-wrap break-words max-h-[20lh] overflow-y-hidden hover:overflow-y-auto" style="scrollbar-width: thin;">{block.content}</pre>
                  </div>
                {:else if block.type === 'web_search'}
                  {#if block.queries.length > 0}
                    <div>
                      <div class="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Queries</div>
                      <pre class="m-0 text-[12px] leading-relaxed text-text-tertiary font-mono whitespace-pre-wrap break-words max-h-[20lh] overflow-y-hidden hover:overflow-y-auto" style="scrollbar-width: thin;">{block.queries.join('\n')}</pre>
                    </div>
                  {/if}
                  {#if block.references.length > 0}
                    <div>
                      <div class="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1">References</div>
                      <pre class="m-0 text-[12px] leading-relaxed text-text-tertiary font-mono whitespace-pre-wrap break-words max-h-[20lh] overflow-y-hidden hover:overflow-y-auto" style="scrollbar-width: thin;">{@html highlightJson(formatStructuredValue(block.references))}</pre>
                    </div>
                  {/if}
                {:else}
                  {#if block.args != null}
                    {@const sandbox = extractSandboxScript(block)}
                    <div>
                      <div class="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Input</div>
                      {#if sandbox}
                        {#if sandbox.restHtml}
                          <pre class="m-0 mb-2 text-[12px] leading-relaxed text-text-tertiary font-mono whitespace-pre-wrap break-words" style="scrollbar-width: thin;">{@html sandbox.restHtml}</pre>
                        {/if}
                        <pre class="m-0 text-[12px] leading-relaxed text-text-tertiary font-mono whitespace-pre-wrap break-words max-h-[20lh] overflow-y-hidden hover:overflow-y-auto hljs" style="scrollbar-width: thin;">{@html sandbox.scriptHtml}</pre>
                      {:else}
                        <pre class="m-0 text-[12px] leading-relaxed text-text-tertiary font-mono whitespace-pre-wrap break-words max-h-[20lh] overflow-y-hidden hover:overflow-y-auto" style="scrollbar-width: thin;">{@html highlightJson(formatStructuredValue(block.args))}</pre>
                      {/if}
                    </div>
                  {/if}
                  {#if block.output != null}
                    {@const chainImages = parseChainImageOutput(block)}
                    <div>
                      <div class="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Output</div>
                      {#if chainImages}
                        <div class="flex flex-wrap gap-2">
                          {#each chainImages as img (img.fileId)}
                            <ImageTile
                              alt={img.name}
                              src={toApiUrl(`/files/${img.fileId}/content`)}
                              frameWidth={280}
                              frameHeight={180}
                              variant="message"
                            />
                          {/each}
                        </div>
                      {:else}
                        <pre class="m-0 text-[12px] leading-relaxed text-text-tertiary font-mono whitespace-pre-wrap break-words max-h-[20lh] overflow-y-hidden hover:overflow-y-auto" style="scrollbar-width: thin;">{@html highlightJson(formatStructuredValue(block.output))}</pre>
                      {/if}
                    </div>
                  {/if}
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
