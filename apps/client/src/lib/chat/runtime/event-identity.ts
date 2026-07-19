import type { BackendEvent, Block, RunId, ThreadId } from '@wonderlands/contracts/chat'
import { asRunId, asThreadId } from '@wonderlands/contracts/chat'

export const eventRunId = (event: BackendEvent): RunId | null => {
  if (!('runId' in event.payload) || typeof event.payload.runId !== 'string') {
    return null
  }

  return asRunId(event.payload.runId)
}

export const eventThreadId = (event: BackendEvent): ThreadId | null => {
  if (!('threadId' in event.payload) || typeof event.payload.threadId !== 'string') {
    return null
  }

  return asThreadId(event.payload.threadId)
}

export const isChildTranscriptEvent = (event: BackendEvent): boolean => {
  switch (event.type) {
    case 'generation.completed':
    case 'reasoning.summary.delta':
    case 'reasoning.summary.done':
    case 'stream.delta':
    case 'stream.done':
    case 'tool.called':
    case 'tool.confirmation_requested':
    case 'tool.confirmation_granted':
    case 'tool.confirmation_rejected':
    case 'tool.completed':
    case 'tool.failed':
    case 'tool.waiting':
    case 'wait.timed_out':
    case 'web_search.progress':
    case 'run.cancelled':
    case 'run.failed':
      return true
    default:
      return false
  }
}

export const isDelegationParentBlock = (block: Block): block is Block & { childRunId: string } =>
  block.type === 'tool_interaction' &&
  block.name === 'delegate_to_agent' &&
  typeof block.childRunId === 'string' &&
  block.childRunId.trim().length > 0

export const doesEventSettleAssistantAttachments = (event: BackendEvent): boolean => {
  switch (event.type) {
    case 'generation.completed':
    case 'stream.done':
    case 'run.cancelled':
    case 'run.completed':
    case 'run.failed':
    case 'run.waiting':
      return true
    default:
      return false
  }
}
