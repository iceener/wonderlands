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

type ContractCase = { name: string; run: () => void }
const contractCases: ContractCase[] = []
const contractCase = (name: string, run: () => void) => contractCases.push({ name, run })

contractCase('resolveAiModelTarget uses explicit model with explicit provider', () => {
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

contractCase('resolveAiModelTarget falls back to provider defaults', () => {
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

contractCase('resolveAiModelTarget rejects unknown aliases', () => {
  const result = resolveAiModelTarget(registry, {
    modelAlias: 'missing',
  })

  assert.equal(result.ok, false)

  if (result.ok) {
    return
  }

  assert.match(result.error.message, /Unknown AI model alias/)
})

test('AI model registry contract matrix', () => {
  for (const contract of contractCases) {
    assert.doesNotThrow(contract.run, contract.name)
  }
})
