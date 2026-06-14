<script lang="ts">
import ActionButton from './ActionButton.svelte'

type TextRow = { id: string; value: string }
type KeyValueRow = { id: string; key: string; value: string }

interface TextProps {
  mode: 'text'
  rows: TextRow[]
  placeholder?: string
  onupdate: (id: string, value: string) => void
  onadd: () => void
  onremove: (id: string) => void
  addLabel?: string
}

interface KvProps {
  mode: 'kv'
  rows: KeyValueRow[]
  keyPlaceholder?: string
  valuePlaceholder?: string
  onupdatekey: (id: string, key: string) => void
  onupdatevalue: (id: string, value: string) => void
  onadd: () => void
  onremove: (id: string) => void
  addLabel?: string
}

type Props = TextProps | KvProps

let props: Props = $props()
</script>

<div class="space-y-2">
  {#if props.mode === 'text'}
    {#each props.rows as row (row.id)}
      <div class="flex gap-2">
        <input
          type="text"
          class="min-w-0 flex-1 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
          placeholder={props.placeholder ?? 'Value'}
          value={row.value}
          oninput={(e) => props.onupdate(row.id, e.currentTarget.value)}
        />
        <ActionButton onclick={() => props.onremove(row.id)}>Remove</ActionButton>
      </div>
    {/each}
  {:else}
    {#each props.rows as row (row.id)}
      <div class="flex gap-2">
        <input
          type="text"
          class="min-w-0 flex-1 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
          placeholder={props.keyPlaceholder ?? 'Key'}
          value={row.key}
          oninput={(e) => props.onupdatekey(row.id, e.currentTarget.value)}
        />
        <input
          type="text"
          class="min-w-0 flex-[1.5] rounded-md border border-border bg-surface-0 px-3 py-1.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
          placeholder={props.valuePlaceholder ?? 'Value'}
          value={row.value}
          oninput={(e) => props.onupdatevalue(row.id, e.currentTarget.value)}
        />
        <ActionButton onclick={() => props.onremove(row.id)}>Remove</ActionButton>
      </div>
    {/each}
  {/if}
</div>

<div class="mt-2 flex justify-end">
  <ActionButton onclick={() => props.onadd()}>{props.addLabel ?? 'Add Row'}</ActionButton>
</div>
