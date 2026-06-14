<script lang="ts">
import IconBase from './IconBase.svelte'

interface Props {
  class?: string
  title?: string
}

let { class: className = '', title }: Props = $props()
</script>

<IconBase class={className} {title}>
  <path d="M7.5 3.5h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
  <path d="M5.5 8.5h13" />
  <path d="M10.25 8.5v12" />
  <path d="M14.75 8.5v12" />
  <path d="M5.5 12.5h13" />
  <path d="M5.5 16.5h13" />
  <rect x="5.5" y="3.5" width="13" height="5" rx="1.5" fill="currentColor" fill-opacity="0.12" stroke="none" />
</IconBase>
