<script lang="ts">
import { resolveImageDisplayUrl } from '../services/authenticated-asset'
import type { ImagePreviewItem } from './types'

interface Props {
  item: ImagePreviewItem
}

let { item }: Props = $props()

let displayedUrl = $state('')
let displayState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle')
let disposeDisplayed: (() => void) | null = null

$effect(() => {
  const current = item
  let cancelled = false
  const controller = new AbortController()

  disposeDisplayed?.()
  disposeDisplayed = null
  displayedUrl = ''
  displayState = 'loading'

  void resolveImageDisplayUrl(current.sourceUrl, controller.signal)
    .then((res) => {
      if (cancelled) {
        res.dispose()
        return
      }

      disposeDisplayed = res.dispose
      displayedUrl = res.displayUrl
      displayState = 'ready'
    })
    .catch(() => {
      if (!cancelled) {
        displayedUrl = ''
        displayState = 'error'
      }
    })

  return () => {
    cancelled = true
    controller.abort()
    disposeDisplayed?.()
    disposeDisplayed = null
  }
})
</script>

{#if displayedUrl}
  <img
    src={displayedUrl}
    alt={item.alt}
    class="max-h-[min(85dvh,880px)] max-w-full object-contain"
  />
{:else if displayState === 'error'}
  <div class="flex h-48 w-full max-w-md items-center justify-center text-[13px] text-text-tertiary">
    Preview unavailable.
  </div>
{:else}
  <div class="flex h-48 w-full max-w-md items-center justify-center text-[13px] text-text-tertiary">
    Loading…
  </div>
{/if}
