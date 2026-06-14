<script lang="ts">
import type { ErrorBlock as ErrorBlockModel } from '@wonderlands/contracts/chat'

interface Props {
  block?: ErrorBlockModel
  message?: string
  action?: { label: string; onclick: () => void } | null
}

let { block, message, action = null }: Props = $props()

const displayMessage = $derived(message ?? block?.message ?? '')
</script>

<div class="flex items-start gap-2 py-1 text-danger-text/90" role="alert" aria-live="assertive">
  <div class="w-4 h-4 flex items-center justify-center shrink-0 mt-[2px]">
    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
  </div>
  <div class="flex items-center gap-3 min-w-0">
    <span class="text-[13px] leading-relaxed">{displayMessage}</span>
    {#if action}
      <button
        type="button"
        class="text-[12px] font-medium underline underline-offset-2 hover:text-danger-text shrink-0"
        onclick={action.onclick}
      >
        {action.label}
      </button>
    {/if}
  </div>
</div>
