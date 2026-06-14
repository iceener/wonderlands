<script lang="ts">
import type { Snippet } from 'svelte'

interface Props {
  class?: string
  children?: Snippet
  title?: string
}

let { class: className = '', children, title }: Props = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  role={title ? 'img' : undefined}
  aria-hidden={title ? undefined : 'true'}
  aria-label={title}
>
  {#if title}
    <title>{title}</title>
  {/if}
  {@render children?.()}
</svg>
