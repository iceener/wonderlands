import type { BackendFilePickerResult, MessageAttachment } from '@wonderlands/contracts/chat'
import { toApiUrl } from '../../services/backend'

export const EMPTY_THREAD_TIPS = [
  'Type # to attach a file, @ to mention an agent, / for commands',
  'Type / to browse available commands',
  'Use # to search and attach files from your project',
] as const

export const ACTIVE_THREAD_TIPS = [
  'Type # to attach a file, @ to mention an agent, / for commands',
  'Use ↑ to navigate messages, c to copy, esc to dismiss',
  'Type / to browse available commands',
  'Press ↑ in an empty input to browse previous messages',
  'Use # to search and attach files from your project',
] as const

export const pickTip = (tips: readonly string[], random = Math.random): string =>
  tips[Math.floor(random() * tips.length)] ?? tips[0] ?? ''

export const pickComposerPlaceholderTip = (
  hasMessages: boolean,
  lastHasMessages: boolean | null,
  random = Math.random,
): { lastHasMessages: boolean; tip: string } | null => {
  if (hasMessages === lastHasMessages) {
    return null
  }

  return {
    lastHasMessages: hasMessages,
    tip: pickTip(hasMessages ? ACTIVE_THREAD_TIPS : EMPTY_THREAD_TIPS, random),
  }
}

export const toPickedImageAttachment = (
  result: BackendFilePickerResult,
): MessageAttachment | null => {
  if (result.source !== 'attachment' || !result.fileId || !result.mimeType?.startsWith('image/')) {
    return null
  }

  const contentUrl = toApiUrl(`/files/${result.fileId}/content`)

  return {
    id: result.fileId,
    kind: 'image',
    mime: result.mimeType,
    name: result.label,
    size: result.sizeBytes ?? 0,
    thumbnailUrl: contentUrl,
    url: contentUrl,
  }
}

export interface ComposerTargetAgent {
  id: string
  name: string
}

export type ComposerTargetCycleEntry =
  | { mode: 'default' }
  | { id: string; mode: 'agent'; name: string }

export const buildTargetCycle = (
  agents: readonly ComposerTargetAgent[],
): ComposerTargetCycleEntry[] => [
  { mode: 'default' },
  ...agents.map((agent) => ({ mode: 'agent' as const, id: agent.id, name: agent.name })),
]

export const getNextTarget = (
  cycle: readonly ComposerTargetCycleEntry[],
  currentMode: 'default' | 'agent',
  currentAgentId: string | null,
): ComposerTargetCycleEntry => {
  if (cycle.length === 0) {
    return { mode: 'default' }
  }

  let currentIndex = 0
  if (currentMode === 'agent' && currentAgentId) {
    const agentIndex = cycle.findIndex(
      (entry) => entry.mode === 'agent' && entry.id === currentAgentId,
    )
    if (agentIndex >= 0) {
      currentIndex = agentIndex
    }
  }

  return cycle[(currentIndex + 1) % cycle.length] ?? { mode: 'default' }
}
