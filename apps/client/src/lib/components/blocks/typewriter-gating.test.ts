import { describe, expect, test } from 'vitest'

import { shouldEnableTypewriterGate } from './typewriter-gating'

describe('shouldEnableTypewriterGate', () => {
  test('disables typewriter finishing when the message was cancelled', () => {
    expect(
      shouldEnableTypewriterGate({
        enabled: true,
        finishReason: 'cancelled',
        isLatest: true,
        messageWasLiveStreamed: true,
      }),
    ).toBe(false)
  })

  test('keeps typewriter finishing enabled for normal completed messages', () => {
    expect(
      shouldEnableTypewriterGate({
        enabled: true,
        finishReason: 'stop',
        isLatest: true,
        messageWasLiveStreamed: true,
      }),
    ).toBe(true)
  })

  test('disables typewriter for durable text handoff replay after streamed text already rendered', () => {
    expect(
      shouldEnableTypewriterGate({
        enabled: true,
        finishReason: 'stop',
        isDurableTextHandoffReplay: true,
        isLatest: true,
        messageWasLiveStreamed: true,
      }),
    ).toBe(false)
  })

  test('disables typewriter for messages loaded from persistence (not live-streamed)', () => {
    expect(
      shouldEnableTypewriterGate({
        enabled: true,
        finishReason: 'stop',
        isLatest: true,
        messageWasLiveStreamed: false,
      }),
    ).toBe(false)
  })

  test('disables typewriter when not the latest message', () => {
    expect(
      shouldEnableTypewriterGate({
        enabled: true,
        finishReason: 'stop',
        isLatest: false,
        messageWasLiveStreamed: true,
      }),
    ).toBe(false)
  })

  test('disables typewriter when typewriter is disabled', () => {
    expect(
      shouldEnableTypewriterGate({
        enabled: false,
        finishReason: 'stop',
        isLatest: true,
        messageWasLiveStreamed: true,
      }),
    ).toBe(false)
  })
})
