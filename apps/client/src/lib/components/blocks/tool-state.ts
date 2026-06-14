import type { ToolInteractionBlock } from '@wonderlands/contracts/chat'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readSuspendTargetKind = (block: ToolInteractionBlock): string | null =>
  isRecord(block.args) && typeof block.args.targetKind === 'string' ? block.args.targetKind : null

export const isSuspendedToolBlock = (block: ToolInteractionBlock): boolean =>
  block.name === 'suspend_run' && block.status === 'running'

export const getSuspendedToolLabel = (block: ToolInteractionBlock): string => {
  const targetKind = readSuspendTargetKind(block)

  switch (targetKind) {
    case 'human_response':
      return 'Awaiting reply'
    case 'upload':
      return 'Awaiting upload'
    case 'human_approval':
      return 'Awaiting approval'
    default:
      return 'Awaiting input'
  }
}
