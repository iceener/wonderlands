<script lang="ts">
import { chatWidth } from '../stores/chat-width.svelte'

let dragging = $state(false)
let side: 'left' | 'right' = 'right'
let startX = 0
let startW = 0

function onDown(s: 'left' | 'right', e: PointerEvent) {
  dragging = true
  side = s
  startX = e.clientX
  startW = chatWidth.value
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}

function onMove(e: PointerEvent) {
  if (!dragging) return
  const dx = e.clientX - startX
  chatWidth.value = startW + (side === 'right' ? dx : -dx) * 2
}

function onUp() {
  dragging = false
}

function resetWidth() {
  chatWidth.value = chatWidth.DEFAULT
}
</script>

<div
  class="pointer-events-none absolute inset-0 z-20 mx-auto hidden md:block"
  style:max-width="{chatWidth.value}px"
  aria-hidden="true"
>
  <div
    class="pointer-events-auto absolute -left-1.5 top-0 bottom-0 w-3 cursor-col-resize select-none group"
    onpointerdown={(e) => onDown('left', e)}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    ondblclick={resetWidth}
    role="separator"
    aria-orientation="vertical"
  >
    <div
      class="mx-auto h-full w-px bg-border opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      style:opacity={dragging ? '1' : null}
    ></div>
  </div>
  <div
    class="pointer-events-auto absolute -right-1.5 top-0 bottom-0 w-3 cursor-col-resize select-none group"
    onpointerdown={(e) => onDown('right', e)}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    ondblclick={resetWidth}
    role="separator"
    aria-orientation="vertical"
  >
    <div
      class="mx-auto h-full w-px bg-border opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      style:opacity={dragging ? '1' : null}
    ></div>
  </div>
</div>
