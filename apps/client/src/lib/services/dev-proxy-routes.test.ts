import { describe, expect, it } from 'vitest'

import {
  matchesApiProxyPath,
  matchesGardenLiveProxyPath,
  normalizeProxyPath,
} from './dev-proxy-routes'

describe('dev-proxy-routes', () => {
  it('normalizes repeated leading slashes', () => {
    expect(normalizeProxyPath('///123')).toBe('/123')
    expect(normalizeProxyPath('/wonderlands')).toBe('/wonderlands')
  })

  it('matches primary and compatibility api routes with one or more leading slashes', () => {
    expect(matchesApiProxyPath('/api/gardens')).toBe(true)
    expect(matchesApiProxyPath('//api/gardens')).toBe(true)
    expect(matchesApiProxyPath('/v1/gardens')).toBe(true)
    expect(matchesApiProxyPath('//v1/gardens')).toBe(true)
    expect(matchesApiProxyPath('/123')).toBe(false)
  })

  it('matches public root and live garden slugs, including numeric-only slugs', () => {
    expect(matchesGardenLiveProxyPath('/')).toBe(true)
    expect(matchesGardenLiveProxyPath('/123')).toBe(true)
    expect(matchesGardenLiveProxyPath('/wonderlands')).toBe(true)
    expect(matchesGardenLiveProxyPath('/wonderlands/books/demo')).toBe(true)
    expect(matchesGardenLiveProxyPath('//123')).toBe(true)
  })

  it('does not match app-shell, vite internals, or api-prefixed paths', () => {
    expect(matchesGardenLiveProxyPath('/ai')).toBe(false)
    expect(matchesGardenLiveProxyPath('/ai/threads')).toBe(false)
    expect(matchesGardenLiveProxyPath('/api/gardens')).toBe(false)
    expect(matchesGardenLiveProxyPath('/v1/gardens')).toBe(false)
    expect(matchesGardenLiveProxyPath('/@vite/client')).toBe(false)
    expect(matchesGardenLiveProxyPath('/favicon.ico')).toBe(false)
  })
})
