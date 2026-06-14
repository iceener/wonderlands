const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const pathExistsInNode = async (path) => {
  const { access } = await import('node:fs/promises')

  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const pathExistsInLo = async (path) => {
  const core = globalThis.lo?.core

  if (!core?.access) {
    throw new Error('lo runtime does not expose the MCP bridge access primitive')
  }

  return core.access(path, core.F_OK) === 0
}

const readTextFileInNode = async (path) => {
  const { readFile } = await import('node:fs/promises')
  return await readFile(path, 'utf8')
}

const writeTextFileInNode = async (path, content) => {
  const { rename, writeFile } = await import('node:fs/promises')
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, content, 'utf8')
  await rename(temporaryPath, path)
}

const readTextFileInLo = async (path) => {
  const runtime = globalThis.lo
  const core = runtime?.core

  if (!runtime?.ptr || !core?.open || !core?.fstat || !core?.read2 || !core?.close) {
    throw new Error('lo runtime does not expose the MCP bridge read primitives')
  }

  const statBytes = runtime.ptr(new Uint8Array(160))
  const statWords = new BigUint64Array(statBytes.buffer)
  const fd = core.open(path, core.defaultReadFlags, 0)

  if (fd < 0) {
    throw new Error(`lo runtime could not open MCP bridge file at ${path}: errno ${runtime.errno}`)
  }

  try {
    if (core.fstat(fd, statBytes.ptr) !== 0) {
      throw new Error(`lo runtime could not stat MCP bridge file at ${path}: errno ${runtime.errno}`)
    }

    const size = core.os === 'mac' ? Number(statWords[12]) : Number(statWords[6])

    if (size <= 0) {
      return ''
    }

    const bytes = runtime.ptr(new Uint8Array(size))
    const readCount = core.read2(fd, bytes.ptr, bytes.length)

    if (readCount < 0) {
      throw new Error(`lo runtime could not read MCP bridge file at ${path}: errno ${runtime.errno}`)
    }

    return textDecoder.decode(readCount === bytes.length ? bytes : bytes.subarray(0, readCount))
  } finally {
    core.close(fd)
  }
}

const writeTextFileInLo = async (path, content) => {
  const core = globalThis.lo?.core

  if (!core?.writeFile || !core?.rename) {
    throw new Error('lo runtime does not expose the MCP bridge file primitives')
  }

  const temporaryPath = `${path}.tmp`
  const bytes = textEncoder.encode(content)
  const written = core.writeFile(
    temporaryPath,
    bytes,
    core.defaultWriteFlags,
    core.defaultWriteMode,
  )

  if (written !== bytes.length) {
    throw new Error(`lo runtime wrote ${written} of ${bytes.length} MCP bridge bytes`)
  }

  if (core.rename(temporaryPath, path) !== 0) {
    throw new Error(`lo runtime could not publish MCP bridge response at ${path}`)
  }
}

const readTextFile = async (path) => {
  if (globalThis.process?.versions?.node) {
    return await readTextFileInNode(path)
  }

  return await readTextFileInLo(path)
}

const writeTextFile = async (path, content) => {
  if (globalThis.process?.versions?.node) {
    await writeTextFileInNode(path, content)
    return
  }

  await writeTextFileInLo(path, content)
}

const pathExists = async (path) => {
  if (globalThis.process?.versions?.node) {
    return await pathExistsInNode(path)
  }

  return await pathExistsInLo(path)
}

const isMissingBridgeFileError = (error) =>
  (typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT') ||
  /failed to open/i.test(String(error))

const sleep = async (ms) => {
  if (!globalThis.process?.versions?.node && typeof globalThis.lo?.core?.usleep === 'function') {
    globalThis.lo.core.usleep(ms * 1000)
    return
  }

  if (typeof globalThis.setTimeout === 'function') {
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms)
    })
    return
  }

  throw new Error('sandbox runtime cannot wait for MCP bridge responses')
}

const createBridgeError = (error) => {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return new Error(error.message)
  }

  return new Error('Unknown MCP bridge error')
}

export const installMcpBridge = (manifest) => {
  const bridge = manifest?.mcpBridge

  if (!bridge) {
    return
  }

  let sequence = 0
  let pendingCalls = 0
  let idleResolvers = []
  const pollIntervalMs =
    typeof bridge.pollIntervalMs === 'number' && bridge.pollIntervalMs > 0
      ? Math.floor(bridge.pollIntervalMs)
      : 10
  const responseTimeoutMs = Math.max(
    1_000,
    Number(manifest?.policy?.runtime?.maxDurationSec ?? 120) * 1_000,
  )

  const resolveIdleWaiters = () => {
    if (pendingCalls !== 0 || idleResolvers.length === 0) {
      return
    }

    const waiters = idleResolvers
    idleResolvers = []

    for (const resolveIdle of waiters) {
      resolveIdle()
    }
  }

  globalThis.__wonderlandsWaitForMcpIdle = async () => {
    if (pendingCalls === 0) {
      return
    }

    await new Promise((resolveIdle) => {
      idleResolvers.push(resolveIdle)
    })
  }

  globalThis.__wonderlandsCallMcp = async (runtimeName, args) => {
    if (typeof runtimeName !== 'string' || runtimeName.trim().length === 0) {
      throw new Error('MCP bridge runtimeName must be a non-empty string')
    }

    pendingCalls += 1

    const id = `mcp_${++sequence}`
    const requestPath = `${bridge.requestsDirHostPath}/${id}.json`
    const responsePath = `${bridge.responsesDirHostPath}/${id}.json`

    try {
      await writeTextFile(
        requestPath,
        JSON.stringify({
          args: args ?? {},
          id,
          runtimeName,
          type: 'wonderlands_mcp_call',
        }),
      )

      const deadlineAt = Date.now() + responseTimeoutMs

      while (Date.now() <= deadlineAt) {
        const responseReady = await pathExists(responsePath)

        if (!responseReady) {
          await sleep(pollIntervalMs)
          continue
        }

        let responseText = null

        try {
          responseText = await readTextFile(responsePath)
        } catch (error) {
          if (!isMissingBridgeFileError(error)) {
            throw error
          }
        }

        if (responseText !== null) {
          const response = JSON.parse(responseText)

          if (response?.ok) {
            return response.result ?? null
          }

          throw createBridgeError(response?.error)
        }

        await sleep(pollIntervalMs)
      }

      throw new Error(`MCP bridge timed out waiting for response to ${runtimeName}`)
    } finally {
      pendingCalls = Math.max(0, pendingCalls - 1)
      resolveIdleWaiters()
    }
  }
}
