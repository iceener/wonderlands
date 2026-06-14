<script lang="ts">
import IconBase from './IconBase.svelte'

interface Props {
  class?: string
  title?: string
}

let { class: className = '', title }: Props = $props()
</script>

<IconBase class={className} {title}>
  <path d="m9.25 8.25-3.5 3.75 3.5 3.75" />
  <path d="m14.75 8.25 3.5 3.75-3.5 3.75" />
  <path d="m13.1 5.5-2.2 13" />
  <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
</IconBase>
