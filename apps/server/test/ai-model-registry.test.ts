import assert from 'node:assert/strict'
import { test } from 'vitest'

import { resolveAiModelTarget } from '../src/domain/ai/model-registry'

const registry = {
  aliases: {
    default: {
      model: 'gpt-5.4',
      provider: 'openai' as const,
    },
    google_default: {
      model: 'gemini-2.5-flash',
      provider: 'google' as const,
    },
    openai_default: {
      model: 'gpt-5.4',
      provider: 'openai' as const,
    },
  },
  defaultAlias: 'default',
}

test('resolveAiModelTarget uses explicit model with explicit provider', () => {
  const result = resolveAiModelTarget(registry, {
    model: 'gpt-5.4-mini',
    provider: 'openai',
  })

  assert.equal(result.ok, true)

  if (!result.ok) {
    return
  }

  assert.deepEqual(result.value, {
    model: 'gpt-5.4-mini',
    provider: 'openai',
  })
})

test('resolveAiModelTarget falls back to provider defaults', () => {
  const result = resolveAiModelTarget(registry, {
    provider: 'google',
  })

  assert.equal(result.ok, true)

  if (!result.ok) {
    return
  }

  assert.deepEqual(result.value, {
    model: 'gemini-2.5-flash',
    provider: 'google',
  })
})

test('resolveAiModelTarget rejects unknown aliases', () => {
  const result = resolveAiModelTarget(registry, {
    modelAlias: 'missing',
  })

  assert.equal(result.ok, false)

  if (result.ok) {
    return
  }

  assert.match(result.error.message, /Unknown AI model alias/)
})
