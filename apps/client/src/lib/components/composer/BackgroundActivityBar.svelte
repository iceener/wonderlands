<script lang="ts">
import type { ThreadActivityState } from '@wonderlands/contracts/chat'
import type { ActivityThread } from '../../stores/background-activity.svelte'

interface Props {
  threads: ActivityThread[]
  onSelect?: (threadId: string) => void
}

let { threads, onSelect }: Props = $props()

let expanded = $state(false)

const summary = $derived.by(() => {
  const counts = new Map<ThreadActivityState, number>()
  for (const t of threads) {
    counts.set(t.state, (counts.get(t.state) ?? 0) + 1)
  }

  const order: { state: ThreadActivityState; label: string }[] = [
    { state: 'approval', label: 'approve' },
    { state: 'running', label: 'running' },
    { state: 'pending', label: 'pending' },
    { state: 'waiting', label: 'waiting' },
    { state: 'failed', label: 'failed' },
    { state: 'completed', label: 'done' },
  ]

  return order
    .filter(({ state }) => (counts.get(state) ?? 0) > 0)
    .map(({ state, label }) => ({ state, label, count: counts.get(state)! }))
})

const visible = $derived(threads.length > 0)

const handleBarClick = () => {
  expanded = !expanded
}

const handleThreadClick = (threadId: string) => {
  expanded = false
  onSelect?.(threadId)
}
</script>

{#if visible}
  <div class="activity-bar mx-auto flex px-4 pb-0.5" style="max-width: calc(var(--chat-max-w, 42rem) + 5rem)">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded border border-border/40 bg-surface-1/40 px-2 py-0.5 text-[10px] text-text-tertiary"
      onclick={handleBarClick}
    >
      {#each summary as entry (entry.state)}
        <span class="activity-entry inline-flex items-center gap-1" data-activity={entry.state}>
          <span class="activity-dot"></span>
          {entry.count} {entry.label}
        </span>
      {/each}
    </button>
  </div>

  {#if expanded}
    <div class="mx-auto px-4 pb-0.5" style="max-width: var(--chat-max-w, 42rem)">
      <div class="max-h-[10rem] overflow-y-auto overscroll-contain rounded-lg border border-border/50 bg-surface-0">
        {#each threads as thread (thread.id)}
          <button
            type="button"
            class="activity-thread flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-text-primary transition-colors hover:bg-surface-1"
            onclick={() => handleThreadClick(thread.id)}
          >
            <span class="activity-entry inline-flex items-center shrink-0" data-activity={thread.state}>
              <span class="activity-dot"></span>
            </span>
            <span class="flex-1 truncate">{thread.title}</span>
            <span class="activity-entry shrink-0 text-[10px]" data-activity={thread.state}>
              {thread.label}
            </span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
{/if}

<style>
  .activity-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    flex-shrink: 0;
    background: currentcolor;
  }

  .activity-entry[data-activity="running"] { color: var(--color-accent); }
  .activity-entry[data-activity="running"] .activity-dot {
    animation: bar-dot-pulse 1.5s ease-in-out infinite;
  }

  .activity-entry[data-activity="pending"] { color: var(--color-text-tertiary); }
  .activity-entry[data-activity="waiting"] { color: var(--color-warning-text); }
  .activity-entry[data-activity="approval"] { color: var(--color-warning-text); }
  .activity-entry[data-activity="approval"] .activity-dot {
    animation: bar-dot-pulse 1s ease-in-out infinite;
  }
  .activity-entry[data-activity="failed"] { color: var(--color-error-text, #ef4444); }
  .activity-entry[data-activity="completed"] { color: var(--color-success-text); }

  .activity-thread + .activity-thread {
    border-top: 1px solid color-mix(in srgb, var(--color-border) 30%, transparent);
  }

  @keyframes bar-dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
