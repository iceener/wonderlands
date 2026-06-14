export type MessageListSurface = 'empty' | 'skeleton' | 'thread'

export interface MessageListSurfaceOptions {
  initialHydrationPending: boolean
  isLoading: boolean
  messageCount: number
}

export const getMessageListSurface = ({
  initialHydrationPending,
  isLoading,
  messageCount,
}: MessageListSurfaceOptions): MessageListSurface => {
  if (messageCount > 0) {
    return 'thread'
  }

  if (initialHydrationPending && isLoading) {
    return 'skeleton'
  }

  return 'empty'
}
