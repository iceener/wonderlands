<script lang="ts">
import type { BackendFilePickerResult } from '@wonderlands/contracts/chat'
import FilePickerPopover from '../lib/components/composer/FilePickerPopover.svelte'

interface Props {
  initialResults: BackendFilePickerResult[]
  onClose?: () => void
  onSelect: (result: BackendFilePickerResult) => void
}

let { initialResults, onClose, onSelect }: Props = $props()
let results = $state<BackendFilePickerResult[]>([])
let selectedIndex = $state(0)

$effect(() => {
  results = initialResults
})

export function replaceResults(nextResults: BackendFilePickerResult[]) {
  results = nextResults
  selectedIndex = 0
}
</script>

<FilePickerPopover
  isOpen={true}
  query="query"
  {results}
  {selectedIndex}
  {onClose}
  {onSelect}
  onHighlight={(index) => {
    selectedIndex = index
  }}
/>
