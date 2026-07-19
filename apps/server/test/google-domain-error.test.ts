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

test('Google domain error maps Interactions client HTTP errors by status', () => {
  // The 2.x Interactions client raises its own APIError hierarchy that is not
  // an instance of the exported ApiError compatibility class.
  const badRequestError = Object.assign(new Error('400 Invalid request schema.'), {
    name: 'BadRequestError',
    status: 400,
  })

  assert.deepEqual(toGoogleDomainError(badRequestError), {
    message: 'Google GenAI rejected the request: 400 Invalid request schema.',
    type: 'validation',
  })

  const rateLimitError = Object.assign(new Error('429 Resource has been exhausted.'), {
    name: 'RateLimitError',
    status: 429,
  })

  assert.deepEqual(toGoogleDomainError(rateLimitError), {
    message: 'Google GenAI rate limit reached: 429 Resource has been exhausted.',
    type: 'capacity',
  })
})

test('Google domain error maps Interactions client user aborts to conflict', () => {
  const abortError = Object.assign(new Error('Request was aborted.'), {
    name: 'APIUserAbortError',
  })

  assert.deepEqual(toGoogleDomainError(abortError), {
    message: 'Google GenAI request was aborted: Request was aborted.',
    type: 'conflict',
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
