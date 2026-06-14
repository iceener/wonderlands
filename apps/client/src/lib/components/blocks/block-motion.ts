import { quintOut } from 'svelte/easing'
import { prefersReducedMotion } from 'svelte/motion'

export const BLOCK_ENTRANCE_STAGGER_MS = 35
export const BLOCK_ENTRANCE_DURATION_MS = 180
export const GROUPING_SETTLE_MS = 180

export interface FadeUpParams {
  delay?: number
  duration?: number
}

export const fadeUpTransition = (
  _node: Element,
  { delay = 0, duration = BLOCK_ENTRANCE_DURATION_MS }: FadeUpParams = {},
) => {
  if (prefersReducedMotion.current) {
    return { delay: 0, duration: 0, css: () => '' }
  }

  return {
    delay,
    duration,
    easing: quintOut,
    css: (t: number, u: number) => `opacity: ${t}; transform: translateY(${u * 4}px);`,
  }
}
