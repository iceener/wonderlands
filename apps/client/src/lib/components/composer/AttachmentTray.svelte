<script lang="ts">
import { fileDraftToPreviewItem, imageDraftsToPreviewItems } from '../../preview/preview-adapters'
import { tryGetPreviewContext } from '../../preview/preview-context'
import type { AttachmentDraft } from '../../stores/attachment-drafts.svelte'
import FileChip from '../FileChip.svelte'
import ImageTile from '../ImageTile.svelte'

interface Props {
  disabled?: boolean
  drafts?: AttachmentDraft[]
  onRemove?: ((localId: string) => void) | null
  onReplaceDraftFile?: ((localId: string, file: File) => void) | null
}

let { disabled = false, drafts = [], onRemove = null, onReplaceDraftFile = null }: Props = $props()
const preview = tryGetPreviewContext()

const openDraftPreview = (localId: string) => {
  if (!preview) {
    return
  }

  const imageDrafts = drafts.filter((draft) => draft.kind === 'image')
  const items = imageDraftsToPreviewItems(imageDrafts)
  const index = imageDrafts.findIndex((draft) => draft.localId === localId)
  preview.openGallery(items, Math.max(0, index))
}

const openFileDraftPreview = async (draft: AttachmentDraft) => {
  if (!preview) return
  const saveHandler = onReplaceDraftFile
    ? (content: string) => {
        const file = new File([content], draft.name, { type: draft.mime })
        onReplaceDraftFile(draft.localId, file)
      }
    : undefined
  const item = await fileDraftToPreviewItem(draft, { saveHandler })
  if (item) preview.openItem(item)
}

const draftStatusLabel = (draft: AttachmentDraft): string | null => {
  if (draft.state === 'error') {
    return 'Upload failed'
  }

  switch (draft.state) {
    case 'queued':
      return 'Queued'

    case 'uploading':
      return 'Uploading…'

    default:
      return null
  }
}
</script>

{#if drafts.length > 0}
  <div class="flex flex-wrap items-start gap-2 pb-2.5" role="list" aria-label="Pending attachments">
    {#each drafts as draft (draft.localId)}
      {#if draft.kind === 'image'}
        <ImageTile
          alt={draft.error ? `${draft.name} — ${draft.error}` : draft.name}
          src={draft.previewUrl ?? draft.objectUrl}
          href={draft.remoteUrl ?? draft.objectUrl}
          variant="tray"
          statusLabel={draftStatusLabel(draft)}
          onOpenPreview={() => {
            openDraftPreview(draft.localId)
          }}
          onRemove={onRemove ? () => onRemove(draft.localId) : null}
          {disabled}
        />
      {:else}
        <FileChip
          attachment={draft}
          href={draft.objectUrl}
          variant="tray"
          statusLabel={draftStatusLabel(draft)}
          onOpenPreview={() => { void openFileDraftPreview(draft) }}
          onRemove={onRemove ? () => onRemove(draft.localId) : null}
          {disabled}
        />
      {/if}
    {/each}
  </div>
{/if}
