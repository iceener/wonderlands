<script lang="ts">
import IconBase from './IconBase.svelte'

interface Props {
  class?: string
  title?: string
}

let { class: className = '', title }: Props = $props()
</script>

<IconBase class={className} {title}>
  <path d="M5.5 7.5h13a1.5 1.5 0 0 1 1.5 1.5v9.5a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2V9a1.5 1.5 0 0 1 1.5-1.5Z" />
  <path d="M4.5 7.5V5.75A1.25 1.25 0 0 1 5.75 4.5h12.5A1.25 1.25 0 0 1 19.5 5.75V7.5" />
  <path d="M9.25 11.5h5.5" />
  <path d="M12 11.5v4.5" />
  <rect x="8.75" y="15.25" width="6.5" height="2.75" rx="1.1" fill="currentColor" fill-opacity="0.12" stroke="none" />
</IconBase>
