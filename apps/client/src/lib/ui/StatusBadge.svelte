<script lang="ts">
type Status =
  | 'ready'
  | 'degraded'
  | 'authorization_required'
  | 'assigned'
  | 'pending'
  | 'unknown'
  | string

interface Props {
  status: Status
  label?: string
}

let { status, label }: Props = $props()

const displayLabel = $derived(label ?? status)

const dotColor = $derived.by(() => {
  switch (status) {
    case 'ready':
    case 'assigned':
      return 'bg-success-text'
    case 'authorization_required':
    case 'add':
      return 'bg-accent'
    case 'degraded':
    case 'remove':
      return 'bg-warning-text'
    default:
      return 'bg-text-tertiary'
  }
})
</script>

<span class="inline-flex items-center gap-1.5 rounded border border-border/40 bg-surface-1/40 px-2 py-0.5 text-[10px] text-text-secondary">
  <span class="h-1 w-1 shrink-0 rounded-full {dotColor}"></span>
  {displayLabel}
</span>
