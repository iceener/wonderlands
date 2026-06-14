import type { MessageFinishReason } from '@wonderlands/contracts/chat'

export const shouldEnableTypewriterGate = (input: {
  enabled: boolean
  finishReason: MessageFinishReason | null
  isDurableTextHandoffReplay?: boolean
  isLatest: boolean
  messageWasLiveStreamed: boolean
}): boolean =>
  input.enabled &&
  input.isLatest &&
  input.messageWasLiveStreamed &&
  !input.isDurableTextHandoffReplay &&
  input.finishReason !== 'cancelled'
