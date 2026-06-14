type FileSequence = Iterable<File> | ArrayLike<File> | null | undefined

interface TransferItemLike {
  kind?: string
  getAsFile?: () => File | null
}

interface TransferLike {
  files?: FileSequence
  items?: Iterable<TransferItemLike> | ArrayLike<TransferItemLike> | null
  types?: Iterable<string> | ArrayLike<string> | null
}

const ATTACHMENT_ACCEPT_VALUES = [
  'image/*',
  '.pdf',
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.rtf',
  '.xml',
  '.yaml',
  '.yml',
  '.log',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.html',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.php',
  '.sh',
] as const

export const ATTACHMENT_ACCEPT_HINT = ATTACHMENT_ACCEPT_VALUES.join(',')

export const toFileArray = (files: FileSequence): File[] => Array.from(files ?? [])

export const collectTransferFiles = (transfer: TransferLike | null | undefined): File[] => {
  if (!transfer) {
    return []
  }

  const filesFromItems = Array.from(transfer.items ?? []).flatMap((item) => {
    if (item.kind !== 'file') {
      return []
    }

    const file = item.getAsFile?.()
    return file ? [file] : []
  })

  if (filesFromItems.length > 0) {
    return filesFromItems
  }

  return toFileArray(transfer.files)
}

export const hasTransferFiles = (
  transfer: Pick<TransferLike, 'types'> | null | undefined,
): boolean => Array.from(transfer?.types ?? []).includes('Files')
