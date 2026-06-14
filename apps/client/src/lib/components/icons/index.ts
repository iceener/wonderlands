import type { Component } from 'svelte'
import { type FileKindIconKey, getFileKindIconKey } from './file-kind'
import IconArchive from './IconArchive.svelte'
import IconCode from './IconCode.svelte'
import IconDocument from './IconDocument.svelte'
import IconFile from './IconFile.svelte'
import IconImage from './IconImage.svelte'
import IconSpreadsheet from './IconSpreadsheet.svelte'

export { getFileKindIconKey } from './file-kind'

type IconProps = {
  class?: string
  title?: string
}

const ICON_COMPONENTS: Record<FileKindIconKey, Component<IconProps>> = {
  archive: IconArchive,
  code: IconCode,
  document: IconDocument,
  file: IconFile,
  image: IconImage,
  spreadsheet: IconSpreadsheet,
}

export const fileKindIcon = (mime: string, extension: string | null): Component<IconProps> =>
  ICON_COMPONENTS[getFileKindIconKey(mime, extension)]
