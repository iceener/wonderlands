<script lang="ts">
import type { Snippet } from 'svelte'

type Variant = 'primary' | 'secondary' | 'danger' | 'accent' | 'ghost'

interface Props {
  variant?: Variant
  type?: 'button' | 'submit'
  disabled?: boolean
  onclick?: () => void
  children: Snippet
}

let {
  variant = 'secondary',
  type = 'button',
  disabled = false,
  onclick,
  children,
}: Props = $props()

const cls: Record<Variant, string> = {
  primary:
    'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md bg-text-primary px-4 text-[13px] font-semibold text-bg shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-25 disabled:shadow-none',
  secondary:
    'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong disabled:opacity-40',
  danger:
    'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-danger/30 bg-danger-soft px-3 text-[12px] text-danger-text transition-colors hover:border-danger/50 hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger/40 disabled:opacity-40',
  accent:
    'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-accent/30 bg-accent/10 px-3 text-[12px] text-accent transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 disabled:opacity-40',
  ghost:
    'inline-flex items-center justify-center whitespace-nowrap text-[11px] text-text-tertiary transition-colors hover:text-text-secondary focus-visible:text-text-secondary focus-visible:outline-none disabled:opacity-40',
}
</script>

<button {type} class={cls[variant]} {disabled} {onclick}>
  {@render children()}
</button>
