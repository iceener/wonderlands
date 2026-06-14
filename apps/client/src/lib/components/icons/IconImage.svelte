<script lang="ts">
import IconBase from './IconBase.svelte'

interface Props {
  class?: string
  title?: string
}

let { class: className = '', title }: Props = $props()
</script>

<IconBase class={className} {title}>
  <path d="M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
  <path d="m6.5 16.5 4.1-4.4a1.2 1.2 0 0 1 1.8 0l2.1 2.3" />
  <path d="m13.8 15.4 1.6-1.8a1.2 1.2 0 0 1 1.8-.1l2.3 2.6" />
  <circle cx="9" cy="9" r="1.6" fill="currentColor" stroke="none" />
</IconBase>
