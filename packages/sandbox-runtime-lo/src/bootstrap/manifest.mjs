const textDecoder = new TextDecoder()

const readTextFileInNode = async (path) => {
  const { readFile } = await import('node:fs/promises')
  return await readFile(path, 'utf8')
}

const readTextFileInLo = async (path) => {
  const bytes = globalThis.lo?.core?.read_file?.(path)

  if (!bytes) {
    throw new Error(`lo runtime could not read manifest at ${path}`)
  }

  return textDecoder.decode(bytes)
}

const readTextFile = async (path) => {
  if (globalThis.process?.versions?.node) {
    return await readTextFileInNode(path)
  }

  if (globalThis.lo?.core?.read_file) {
    return await readTextFileInLo(path)
  }

  throw new Error('sandbox runtime bootstrap does not know how to read files in this runtime')
}

const assertString = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`sandbox manifest is missing ${label}`)
  }
}

export const loadExecutionManifest = async (manifestPath) => {
  const manifestText = await readTextFile(manifestPath)
  const manifest = JSON.parse(manifestText)

  assertString(manifest.executionId, 'executionId')
  assertString(manifest.entryHostPath, 'entryHostPath')
  assertString(manifest.cwdHostPath, 'cwdHostPath')
  assertString(manifest.hostRootRef, 'hostRootRef')

  if (!manifest.request || typeof manifest.request !== 'object') {
    throw new Error('sandbox manifest is missing request')
  }

  if (!manifest.request.source || typeof manifest.request.source !== 'object') {
    throw new Error('sandbox manifest is missing request.source')
  }

  return manifest
}
