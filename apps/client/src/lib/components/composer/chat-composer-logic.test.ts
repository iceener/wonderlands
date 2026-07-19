import { describe, expect, test } from 'vitest'

import {
  ACTIVE_THREAD_TIPS,
  EMPTY_THREAD_TIPS,
  buildTargetCycle,
  getNextTarget,
  pickComposerPlaceholderTip,
  toPickedImageAttachment,
} from './chat-composer-logic'

describe('chat-composer-logic', () => {
  test('picks placeholder tips only when thread state changes', () => {
    const first = pickComposerPlaceholderTip(false, null, () => 0)
    expect(first).toEqual({ lastHasMessages: false, tip: EMPTY_THREAD_TIPS[0] })

    expect(pickComposerPlaceholderTip(false, false, () => 0)).toBeNull()

    const active = pickComposerPlaceholderTip(true, false, () => 0)
    expect(active).toEqual({ lastHasMessages: true, tip: ACTIVE_THREAD_TIPS[0] })
  })

  test('converts image file picker results into attachments', () => {
    expect(
      toPickedImageAttachment({
        fileId: 'file-1',
        label: 'preview.png',
        mimeType: 'image/png',
        relativePath: 'preview.png',
        source: 'attachment',
        sizeBytes: 123,
      }),
    ).toMatchObject({
      id: 'file-1',
      kind: 'image',
      name: 'preview.png',
      size: 123,
    })

    expect(
      toPickedImageAttachment({
        fileId: 'file-2',
        label: 'notes.txt',
        mimeType: 'text/plain',
        relativePath: 'notes.txt',
        source: 'workspace',
        sizeBytes: 2,
      }),
    ).toBeNull()
  })

  test('cycles from the current target to the next available agent', () => {
    const cycle = buildTargetCycle([
      { id: 'agent-1', name: 'Alpha' },
      { id: 'agent-2', name: 'Beta' },
    ])

    expect(getNextTarget(cycle, 'default', null)).toEqual({ mode: 'agent', id: 'agent-1', name: 'Alpha' })
    expect(getNextTarget(cycle, 'agent', 'agent-1')).toEqual({ mode: 'agent', id: 'agent-2', name: 'Beta' })
    expect(getNextTarget(cycle, 'agent', 'missing')).toEqual({ mode: 'agent', id: 'agent-1', name: 'Alpha' })
  })
})
