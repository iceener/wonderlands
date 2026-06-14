<script lang="ts" generics="T extends string">
interface Option {
  value: T
  label: string
  description?: string
}

interface Props {
  options: Option[]
  value: T
  onchange?: (value: T) => void
}

let { options, value, onchange }: Props = $props()
</script>

<div class="flex rounded-lg border border-border bg-surface-1 p-1">
  {#each options as option}
    <button
      type="button"
      class="flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors {option.description ? 'text-left' : 'text-center'} {value === option.value ? 'bg-surface-0 text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}"
      onclick={() => onchange?.(option.value)}
    >
      <span class="block">{option.label}</span>
      {#if option.description}
        <span class="mt-0.5 block text-[12px] font-normal text-text-tertiary">{option.description}</span>
      {/if}
    </button>
  {/each}
</div>
