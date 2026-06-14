<script lang="ts">
import IconBase from './IconBase.svelte'

interface Props {
  class?: string
  title?: string
}

let { class: className = '', title }: Props = $props()
</script>

<IconBase class={className} {title}>
  <path d="M8 3.5h6.5L19.5 8v11a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5Z" />
  <path d="M14.5 3.5V8h5" />
  <path d="M9.5 12.25h5" />
  <path d="M9.5 15h3.5" />
  <circle cx="16.8" cy="16.5" r="1.5" fill="currentColor" stroke="none" />
</IconBase>
