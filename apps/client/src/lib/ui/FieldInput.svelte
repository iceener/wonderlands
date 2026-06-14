<script lang="ts">
interface Props {
  label?: string
  value?: string
  placeholder?: string
  type?: 'text' | 'password' | 'url' | 'email'
  error?: string | null
  disabled?: boolean
  maxlength?: number
  oninput?: (value: string) => void
  bindRef?: (el: HTMLInputElement) => void
}

let {
  label,
  value = '',
  placeholder = '',
  type = 'text',
  error = null,
  disabled = false,
  maxlength,
  oninput,
  bindRef,
}: Props = $props()

let inputEl: HTMLInputElement | null = $state(null)

$effect(() => {
  if (inputEl && bindRef) bindRef(inputEl)
})
</script>

<label class="block">
  {#if label}
    <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
      {label}
    </span>
  {/if}
  <input
    bind:this={inputEl}
    {type}
    class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
    {placeholder}
    {value}
    {disabled}
    {maxlength}
    oninput={(e) => oninput?.(e.currentTarget.value)}
  />
  {#if error}
    <span class="mt-1 block text-[11px] text-danger-text">{error}</span>
  {/if}
</label>
