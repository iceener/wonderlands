<script lang="ts">
type Variant = 'error' | 'success' | 'warning'

interface Props {
  variant?: Variant
  message: string
  ondismiss?: (() => void) | null
}

let { variant = 'error', message, ondismiss = null }: Props = $props()

const cls: Record<Variant, string> = {
  error: 'border-danger/15 bg-danger-soft text-danger-text',
  success: 'border-success/15 bg-success-soft text-success-text',
  warning: 'border-warning/15 bg-warning-soft text-warning-text',
}
</script>

<div class="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] leading-snug {cls[variant]}">
  <p class="min-w-0 flex-1">{message}</p>
  {#if ondismiss}
    <button
      type="button"
      class="mt-0.5 shrink-0 rounded p-0.5 opacity-40 transition-opacity hover:opacity-80"
      aria-label="Dismiss"
      onclick={ondismiss}
    >
      <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8"/><path d="M12 4 4 12"/></svg>
    </button>
  {/if}
</div>
