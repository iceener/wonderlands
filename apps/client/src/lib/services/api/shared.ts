import type { BackendEvent } from '@wonderlands/contracts/chat'
import { asEventId } from '@wonderlands/contracts/chat'

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const parseBackendEvent = (value: unknown): BackendEvent => {
  if (!isObject(value)) {
    throw new Error('Invalid backend event payload received.')
  }

  if (
    typeof value.aggregateId !== 'string' ||
    typeof value.aggregateType !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.eventNo !== 'number' ||
    typeof value.id !== 'string' ||
    !isObject(value.payload) ||
    typeof value.type !== 'string'
  ) {
    throw new Error('Invalid backend event payload received.')
  }

  return {
    ...value,
    id: asEventId(value.id),
  } as BackendEvent
}
