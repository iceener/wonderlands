export type FileKindIconKey = 'archive' | 'code' | 'document' | 'file' | 'image' | 'spreadsheet'

const DOCUMENT_EXTENSIONS = new Set(['doc', 'docx', 'md', 'odt', 'pages', 'pdf', 'rtf', 'txt'])

const SPREADSHEET_EXTENSIONS = new Set(['csv', 'numbers', 'ods', 'tsv', 'xls', 'xlsx'])
const CODE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'css',
  'go',
  'h',
  'hpp',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'mjs',
  'php',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'svg',
  'swift',
  'toml',
  'ts',
  'tsx',
  'xml',
  'yaml',
  'yml',
])
const ARCHIVE_EXTENSIONS = new Set(['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'xz', 'zip'])

const DOCUMENT_MIME_PREFIXES = ['application/msword', 'application/pdf', 'text/plain']
const SPREADSHEET_MIME_PREFIXES = [
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/tab-separated-values',
]
const CODE_MIME_PREFIXES = [
  'application/json',
  'application/xml',
  'application/yaml',
  'text/css',
  'text/html',
  'text/javascript',
  'text/markdown',
  'text/x-',
]
const ARCHIVE_MIME_PREFIXES = [
  'application/gzip',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-bzip',
  'application/x-bzip2',
  'application/x-tar',
  'application/zip',
]

export const getFileKindIconKey = (mime: string, extension: string | null): FileKindIconKey => {
  const normalizedMime = mime.trim().toLowerCase()
  const normalizedExtension = extension?.trim().toLowerCase() ?? null

  if (normalizedMime.startsWith('image/')) {
    return 'image'
  }

  if (
    ARCHIVE_EXTENSIONS.has(normalizedExtension ?? '') ||
    ARCHIVE_MIME_PREFIXES.some((prefix) => normalizedMime.startsWith(prefix))
  ) {
    return 'archive'
  }

  if (
    SPREADSHEET_EXTENSIONS.has(normalizedExtension ?? '') ||
    SPREADSHEET_MIME_PREFIXES.some((prefix) => normalizedMime.startsWith(prefix))
  ) {
    return 'spreadsheet'
  }

  if (
    CODE_EXTENSIONS.has(normalizedExtension ?? '') ||
    CODE_MIME_PREFIXES.some((prefix) => normalizedMime.startsWith(prefix))
  ) {
    return 'code'
  }

  if (
    DOCUMENT_EXTENSIONS.has(normalizedExtension ?? '') ||
    DOCUMENT_MIME_PREFIXES.some((prefix) => normalizedMime.startsWith(prefix)) ||
    normalizedMime.startsWith('text/')
  ) {
    return 'document'
  }

  return 'file'
}
