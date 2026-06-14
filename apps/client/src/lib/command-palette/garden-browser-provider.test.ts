import type { BackendGardenSite } from '@wonderlands/contracts/chat'
import { asGardenBuildId, asGardenSiteId } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'

import { isGardenVisibleInCommandPalette } from './garden-browser-provider.svelte'

const createGardenSite = (status: BackendGardenSite['status']): BackendGardenSite => ({
  buildMode: 'manual',
  createdAt: '2026-04-03T00:00:00.000Z',
  createdByAccountId: 'acc_test',
  currentBuildId: asGardenBuildId('gbd_test'),
  currentPublishedBuildId: null,
  deployMode: 'api_hosted',
  id: asGardenSiteId(`gst_${status}`),
  isDefault: false,
  name: `Garden ${status}`,
  protectedAccessMode: 'none',
  protectedSecretRef: null,
  protectedSessionTtlSeconds: 86400,
  slug: `garden-${status}`,
  sourceScopePath: '.',
  status,
  tenantId: 'ten_test',
  updatedAt: '2026-04-03T00:00:00.000Z',
  updatedByAccountId: 'acc_test',
})

describe('garden browser provider', () => {
  test('hides archived gardens from the command palette listing', () => {
    expect(isGardenVisibleInCommandPalette(createGardenSite('active'))).toBe(true)
    expect(isGardenVisibleInCommandPalette(createGardenSite('draft'))).toBe(true)
    expect(isGardenVisibleInCommandPalette(createGardenSite('disabled'))).toBe(true)
    expect(isGardenVisibleInCommandPalette(createGardenSite('archived'))).toBe(false)
  })
})
