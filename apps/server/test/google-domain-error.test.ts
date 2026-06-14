import assert from 'node:assert/strict'
import { ApiError } from '@google/genai'
import { test } from 'vitest'

import { toGoogleDomainError } from '../src/adapters/ai/google/google-domain-error'

test('Google domain error maps SDK timeout statuses to timeout', () => {
  const domainError = toGoogleDomainError(
    new ApiError({
      message: 'gateway timeout',
      status: 504,
    }),
  )

  assert.deepEqual(domainError, {
    message: 'Google GenAI request timed out: gateway timeout',
    type: 'timeout',
  })
})

test('Google domain error maps SDK connection timeout errors to timeout', () => {
  const timeoutError = Object.assign(new Error('Request timed out.'), {
    name: 'APIConnectionTimeoutError',
  })

  const domainError = toGoogleDomainError(timeoutError)

  assert.deepEqual(domainError, {
    message: 'Google GenAI request timed out: Request timed out.',
    type: 'timeout',
  })
})

test('Google domain error preserves connection failures as provider errors', () => {
  const connectionError = Object.assign(new Error('socket hang up'), {
    name: 'APIConnectionError',
  })

  const domainError = toGoogleDomainError(connectionError)

  assert.deepEqual(domainError, {
    message: 'Google GenAI connection failed: socket hang up',
    provider: 'google',
    type: 'provider',
  })
})
