/**
 * Scrolls the nearest vertical scroll container (overflow-y auto/scroll/overlay with overflow)
 * upward from `start`, or falls back to `window`.
 */
export function scrollFormViewToTop(start: HTMLElement | null | undefined): void {
  if (typeof window === 'undefined') return
  let node: HTMLElement | null = start ?? null
  while (node) {
    const style = window.getComputedStyle(node)
    const oy = style.overflowY
    if (
      (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
      node.scrollHeight > node.clientHeight
    ) {
      node.scrollTo({ top: 0, behavior: 'auto' })
      return
    }
    node = node.parentElement
  }
  window.scrollTo({ top: 0, behavior: 'auto' })
}
