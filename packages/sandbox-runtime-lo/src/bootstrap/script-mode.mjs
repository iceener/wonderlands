import { getInstalledSandboxManifest } from './process-shim.mjs'

const toModuleSpecifier = async (filePath) => {
  if (globalThis.process?.versions?.node) {
    const { pathToFileURL } = await import('node:url')
    return pathToFileURL(filePath).href
  }

  return filePath
}

export const runScriptMode = async (manifest) => {
  const sandboxManifest = getInstalledSandboxManifest() ?? manifest
  const moduleSpecifier = await toModuleSpecifier(sandboxManifest.entryHostPath)
  const loadedModule = await import(moduleSpecifier)

  if (typeof loadedModule.main === 'function') {
    await loadedModule.main(...(sandboxManifest.args ?? []))
    return
  }

  if (typeof loadedModule.default === 'function') {
    await loadedModule.default(...(sandboxManifest.args ?? []))
  }

  if (typeof globalThis.__wonderlandsWaitForMcpIdle === 'function') {
    await globalThis.__wonderlandsWaitForMcpIdle()
  }
}
