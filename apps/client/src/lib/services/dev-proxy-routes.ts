export const normalizeProxyPath = (path: string): string => path.replace(/^\/+/u, '/')

export const appShellBasePath = '/ai/'
export const apiProxyPathPattern = /^\/+(?:api|v1)(?:\/|$)/
export const gardenLiveProxyPathPattern =
  /^\/+(?!(?:ai|api|v1)(?:\/|$)|(?:@vite|@fs|@id)(?:\/|$)|favicon\.ico$).*$/

export const matchesApiProxyPath = (path: string): boolean => apiProxyPathPattern.test(path)

export const matchesGardenLiveProxyPath = (path: string): boolean =>
  gardenLiveProxyPathPattern.test(path)
