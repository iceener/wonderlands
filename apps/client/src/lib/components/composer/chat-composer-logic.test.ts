import { describe, expect, test } from 'vitest'

import { buildTargetCycle, getNextTarget, toPickedImageAttachment } from './chat-composer-logic'

describe('chat-composer-logic', () => {
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

    expect(getNextTarget(cycle, 'default', null)).toEqual({
      mode: 'agent',
      id: 'agent-1',
      name: 'Alpha',
    })
    expect(getNextTarget(cycle, 'agent', 'agent-1')).toEqual({
      mode: 'agent',
      id: 'agent-2',
      name: 'Beta',
    })
    expect(getNextTarget(cycle, 'agent', 'missing')).toEqual({
      mode: 'agent',
      id: 'agent-1',
      name: 'Alpha',
    })
  })
})
