import { createRequire } from 'node:module'

import type { ToolSpec } from '../../domain/tooling/tool-registry'

export type AttachmentRefAccessMode = 'none' | 'sandbox' | 'workspace_files'
export interface InteractionCapabilities {
  browserJobs: boolean
  generateImage: boolean
  sandboxExecute: boolean
  workspaceFiles: boolean
}

const require = createRequire(import.meta.url)

const workspaceReadToolNamePattern = /^files(?:__|\.)fs_read$/

const hasToolNamed = (tools: ToolSpec[], name: string): boolean =>
  tools.some((tool) => tool.name === name)

export const resolveInteractionCapabilities = (
  activeTools: ToolSpec[],
): InteractionCapabilities => ({
  browserJobs: hasToolNamed(activeTools, 'browse'),
  generateImage: hasToolNamed(activeTools, 'generate_image'),
  sandboxExecute: hasToolNamed(activeTools, 'execute'),
  workspaceFiles: activeTools.some((tool) => workspaceReadToolNamePattern.test(tool.name)),
})

export const resolveAttachmentRefAccessModeForCapabilities = (
  capabilities: InteractionCapabilities,
): AttachmentRefAccessMode => {
  if (capabilities.sandboxExecute) {
    return 'sandbox'
  }

  if (capabilities.workspaceFiles) {
    return 'workspace_files'
  }

  return 'none'
}

export const resolveAttachmentRefAccessMode = (activeTools: ToolSpec[]): AttachmentRefAccessMode =>
  resolveAttachmentRefAccessModeForCapabilities(resolveInteractionCapabilities(activeTools))

export const isJustBashAvailableInSandbox = (): boolean => {
  try {
    require.resolve('just-bash')
    return true
  } catch {
    return false
  }
}
