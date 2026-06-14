<script lang="ts">
import { resolveImageDisplayUrl } from '../../services/authenticated-asset'

interface Props {
  src: string
}

let { src }: Props = $props()

let resolvedSrc = $state('')
let failed = $state(false)

$effect(() => {
  const currentSrc = src
  resolvedSrc = ''
  failed = false

  let cancelled = false
  let dispose: (() => void) | null = null
  const controller = new AbortController()

  resolveImageDisplayUrl(currentSrc, controller.signal)
    .then((resolved) => {
      if (cancelled) {
        resolved.dispose()
        return
      }
      resolvedSrc = resolved.displayUrl
      dispose = resolved.dispose
    })
    .catch(() => {
      if (!cancelled) {
        resolvedSrc = ''
        failed = true
      }
    })

  return () => {
    cancelled = true
    controller.abort()
    dispose?.()
    dispose = null
  }
})
</script>

{#if resolvedSrc}
  <img
    src={resolvedSrc}
    alt=""
    class="h-8 w-8 shrink-0 rounded border border-border object-cover"
    loading="lazy"
    onerror={() => { failed = true; resolvedSrc = '' }}
  />
{:else if failed}
  <span
    class="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-surface-1 text-[10px] text-text-tertiary"
    aria-hidden="true"
  >IMG</span>
{:else}
  <span
    class="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-surface-1"
    aria-busy="true"
  >
    <span class="h-3 w-3 animate-pulse rounded-full bg-text-tertiary/30"></span>
  </span>
{/if}
