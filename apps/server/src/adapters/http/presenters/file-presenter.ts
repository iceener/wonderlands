import type { FileRecord } from '../../../domain/files/file-repository'

export const toFileSummary = (apiBasePath: string, file: FileRecord) => ({
  accessScope: file.accessScope,
  contentUrl: `${apiBasePath}/files/${file.id}/content`,
  createdAt: file.createdAt,
  id: file.id,
  mimeType: file.mimeType,
  originalFilename: file.originalFilename,
  sizeBytes: file.sizeBytes,
  sourceKind: file.sourceKind,
  status: file.status,
  title: file.title,
})

export const toUploadedFileResponse = (
  apiBasePath: string,
  input: {
    file: FileRecord
    uploadId: string
  },
) => ({
  ...toFileSummary(apiBasePath, input.file),
  uploadId: input.uploadId,
})
