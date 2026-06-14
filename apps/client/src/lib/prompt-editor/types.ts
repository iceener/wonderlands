import type { Editor, Range } from '@tiptap/core'

export interface ReferencedAgentSelection {
  agentId: string | null
  label: string
  slug: string
}

export interface LargeTextPastePayload {
  editor: Editor
  format: 'markdown' | 'text'
  range: Range
  text: string
}

export interface PromptEditorHandle {
  clear: () => void
  focus: () => void
  getMarkdown: () => string
  getReferencedFileIds: () => string[]
  getReferencedAgent: () => ReferencedAgentSelection | null
  getSubmissionMarkdown: () => string
}
