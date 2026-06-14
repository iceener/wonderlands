import assert from 'node:assert/strict'
import { test } from 'vitest'

import { shouldReflectRunLocalObservations } from '../src/application/memory/reflect-run-local-memory'

test('run-local reflection waits until the raw source context behind observations crosses threshold', () => {
  assert.equal(shouldReflectRunLocalObservations(600, 599), false)
  assert.equal(shouldReflectRunLocalObservations(600, 600), true)
  assert.equal(shouldReflectRunLocalObservations(600, 900), true)
})
