import type { MessageAttachment, MessageAttachmentKind } from '@wonderlands/contracts/chat'
import { uploadAttachment as defaultUploadAttachment } from '../services/attachment-api'

export type AttachmentDraftState = 'queued' | 'ready' | 'uploading' | 'uploaded' | 'error'

export interface AttachmentDraft {
  localId: string
  file: File
  name: string
  size: number
  mime: string
  kind: MessageAttachmentKind
  objectUrl: string
  ownsObjectUrl: boolean
  previewUrl: string | null
  state: AttachmentDraftState
  remoteId: string | null
  remoteThumbnailUrl: string | null
  remoteUrl: string | null
  error: string | null
}

export interface AttachmentDraftStoreDependencies {
  createObjectUrl?: (file: File) => string
  randomUUID?: () => string
  revokeObjectUrl?: (url: string) => void
  uploadAttachment?: (file: File) => Promise<MessageAttachment>
}

const normalizeMime = (file: File): string => {
  const rawMime = file.type.trim()
  if (!rawMime) {
    return 'application/octet-stream'
  }

  const [essenceMime = ''] = rawMime.split(';', 1)
  return essenceMime.trim().toLowerCase() || 'application/octet-stream'
}

const inferKind = (mime: string): MessageAttachmentKind =>
  mime.startsWith('image/') ? 'image' : 'file'

const cloneAttachment = (attachment: MessageAttachment): MessageAttachment => ({ ...attachment })

const toMessageAttachment = (draft: AttachmentDraft): MessageAttachment | null => {
  if (draft.state !== 'uploaded' || !draft.remoteId || !draft.remoteUrl) {
    return null
  }

  const attachment: MessageAttachment = {
    id: draft.remoteId,
    name: draft.name,
    size: draft.size,
    mime: draft.mime,
    kind: draft.kind,
    url: draft.remoteUrl,
    ...(draft.remoteThumbnailUrl ? { thumbnailUrl: draft.remoteThumbnailUrl } : {}),
  }

  return cloneAttachment(attachment)
}

export const createAttachmentDraftStore = (dependencies: AttachmentDraftStoreDependencies = {}) => {
  const createObjectUrl =
    dependencies.createObjectUrl ?? ((file: File) => URL.createObjectURL(file))
  const revokeObjectUrl =
    dependencies.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url))
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID())
  const uploadAttachment =
    dependencies.uploadAttachment ??
    ((file: File) => defaultUploadAttachment(file, { accessScope: 'account_library' }))

  const state = $state<{ drafts: AttachmentDraft[] }>({
    drafts: [],
  })

  const revokeDraftObjectUrl = (draft: AttachmentDraft) => {
    if (!draft.ownsObjectUrl) {
      return
    }

    revokeObjectUrl(draft.objectUrl)
  }

  const findDraft = (localId: string): AttachmentDraft | undefined =>
    state.drafts.find((draft) => draft.localId === localId)

  const clearDrafts = () => {
    for (const draft of state.drafts) {
      revokeDraftObjectUrl(draft)
    }

    state.drafts = []
  }

  return {
    get drafts() {
      return state.drafts
    },

    addFiles(files: File[]) {
      const nextDrafts = files.map((file) => {
        const mime = normalizeMime(file)
        const kind = inferKind(mime)
        const objectUrl = createObjectUrl(file)

        return {
          localId: randomUUID(),
          file,
          name: file.name,
          size: file.size,
          mime,
          kind,
          objectUrl,
          ownsObjectUrl: true,
          previewUrl: kind === 'image' ? objectUrl : null,
          state: 'ready' as const,
          remoteId: null,
          remoteThumbnailUrl: null,
          remoteUrl: null,
          error: null,
        } satisfies AttachmentDraft
      })

      state.drafts.push(...nextDrafts)
      return nextDrafts
    },

    addUploadedAttachments(attachments: MessageAttachment[]) {
      const existingRemoteIds = new Set(
        state.drafts.map((draft) => draft.remoteId?.trim() ?? '').filter(Boolean),
      )

      const nextDrafts = attachments.flatMap((attachment) => {
        const remoteId = attachment.id.trim()
        const remoteUrl = attachment.url.trim()

        if (!remoteId || !remoteUrl || existingRemoteIds.has(remoteId)) {
          return []
        }

        existingRemoteIds.add(remoteId)

        const mime = attachment.mime.trim() || 'application/octet-stream'

        return [
          {
            localId: randomUUID(),
            file: new File([], attachment.name, { type: mime }),
            name: attachment.name,
            size: attachment.size,
            mime,
            kind: attachment.kind,
            objectUrl: remoteUrl,
            ownsObjectUrl: false,
            previewUrl:
              attachment.kind === 'image' ? attachment.thumbnailUrl?.trim() || remoteUrl : null,
            state: 'uploaded' as const,
            remoteId,
            remoteThumbnailUrl:
              attachment.kind === 'image' ? attachment.thumbnailUrl?.trim() || remoteUrl : null,
            remoteUrl,
            error: null,
          } satisfies AttachmentDraft,
        ]
      })

      state.drafts.push(...nextDrafts)
      return nextDrafts
    },

    removeDraft(localId: string) {
      const index = state.drafts.findIndex((draft) => draft.localId === localId)
      if (index === -1) {
        return false
      }

      const [draft] = state.drafts.splice(index, 1)
      if (draft) {
        revokeDraftObjectUrl(draft)
      }

      return true
    },

    replaceDraftFile(localId: string, file: File) {
      const draft = state.drafts.find((d) => d.localId === localId)
      if (!draft) return false

      revokeDraftObjectUrl(draft)
      const objectUrl = createObjectUrl(file)

      draft.file = file
      draft.name = file.name
      draft.size = file.size
      draft.mime = normalizeMime(file)
      draft.objectUrl = objectUrl
      draft.ownsObjectUrl = true
      // Reset upload state since the content changed
      draft.state = 'ready'
      draft.remoteId = null
      draft.remoteUrl = null
      draft.remoteThumbnailUrl = null
      draft.error = null

      return true
    },

    clearAll() {
      clearDrafts()
    },

    async uploadPendingFiles() {
      const pendingDraftIds = state.drafts
        .filter((draft) => draft.state === 'ready' && !draft.remoteUrl)
        .map((draft) => draft.localId)

      await Promise.allSettled(
        pendingDraftIds.map(async (localId) => {
          const draft = findDraft(localId)
          if (!draft) {
            return
          }

          draft.state = 'uploading'
          draft.error = null

          try {
            const uploadedAttachment = await uploadAttachment(draft.file)
            const nextDraft = findDraft(localId)
            if (!nextDraft) {
              return
            }

            nextDraft.kind = uploadedAttachment.kind
            nextDraft.mime = uploadedAttachment.mime
            nextDraft.name = uploadedAttachment.name
            nextDraft.size = uploadedAttachment.size
            nextDraft.remoteId = uploadedAttachment.id
            nextDraft.remoteUrl = uploadedAttachment.url
            nextDraft.remoteThumbnailUrl =
              uploadedAttachment.kind === 'image'
                ? (uploadedAttachment.thumbnailUrl ?? uploadedAttachment.url)
                : null
            nextDraft.state = 'uploaded'
          } catch (error) {
            const nextDraft = findDraft(localId)
            if (!nextDraft) {
              return
            }

            nextDraft.state = 'error'
            nextDraft.error =
              error instanceof Error ? error.message : `Upload failed for ${nextDraft.name}.`
          }
        }),
      )
    },

    validateReadyForSubmit() {
      for (const draft of state.drafts) {
        if (draft.state === 'error') {
          return {
            ok: false as const,
            error:
              draft.error?.trim() || `Upload failed for ${draft.name}. Remove it before sending.`,
          }
        }

        if (draft.state === 'uploading' || draft.state === 'queued') {
          return {
            ok: false as const,
            error: `Wait for ${draft.name} to finish uploading before sending.`,
          }
        }

        if (!draft.remoteId || !draft.remoteUrl) {
          return {
            ok: false as const,
            error: `${draft.name} is not uploaded yet. Wait for the upload to finish or remove it before sending.`,
          }
        }
      }

      return {
        ok: true as const,
      }
    },

    toDraftAttachments() {
      return state.drafts.flatMap((draft) => {
        const attachment = toMessageAttachment(draft)
        return attachment ? [attachment] : []
      })
    },

    dispose() {
      clearDrafts()
    },
  }
}
