const toSandboxEnv = (manifest) => ({
  ...(manifest.env ?? {}),
  SANDBOX_CWD: manifest.cwdHostPath,
  SANDBOX_ENTRY_PATH: manifest.entryHostPath,
  SANDBOX_EXECUTION_ID: manifest.executionId,
  SANDBOX_HOST_ROOT: manifest.hostRootRef,
  SANDBOX_INPUT_DIR: manifest.inputRootRef,
  SANDBOX_OUTPUT_DIR: manifest.outputRootRef,
  ...(manifest.repoRootHostPath
    ? {
        SANDBOX_LO_REPO_ROOT: manifest.repoRootHostPath,
      }
    : {}),
  ...(manifest.runtimeRootHostPath
    ? {
        SANDBOX_LO_RUNTIME_ROOT: manifest.runtimeRootHostPath,
      }
    : {}),
  SANDBOX_WORK_DIR: manifest.workRootRef,
})

const formatConsoleValue = (value) => {
  if (typeof value === 'string') {
    return value
  }

  try {
    const json = JSON.stringify(value)
    return json === undefined ? String(value) : json
  } catch {
    return String(value)
  }
}

const installLoConsoleShim = () => {
  const core = globalThis.lo?.core

  if (!core?.write_string) {
    return
  }

  const writeLine = (fd, args) => {
    const line = args.map(formatConsoleValue).join(' ')
    core.write_string(fd, `${line}\n`)
  }

  const existingConsole = globalThis.console ?? {}

  globalThis.console = {
    ...existingConsole,
    error: (...args) => {
      writeLine(core.STDERR, args)
    },
    log: (...args) => {
      writeLine(core.STDOUT, args)
    },
  }
}

const buildLoProcessShim = (manifest) => ({
  argv: ['lo', manifest.entryHostPath, ...(manifest.args ?? [])],
  cwd: () => manifest.cwdHostPath,
  env: toSandboxEnv(manifest),
  exit: (code = 0) => {
    if (typeof globalThis.lo?.exit === 'function') {
      globalThis.lo.exit(code)
      return
    }

    throw new Error(`sandbox bootstrap requested exit(${code}) without a runtime exit hook`)
  },
})

export const installSandboxGlobals = (manifest) => {
  const sandboxEnv = toSandboxEnv(manifest)

  globalThis.__wonderlandsSandbox = {
    manifest,
    ...(manifest.repoRootHostPath
      ? {
          repoRoot: manifest.repoRootHostPath,
        }
      : {}),
    ...(manifest.runtimeRootHostPath
      ? {
          runtimeRoot: manifest.runtimeRootHostPath,
        }
      : {}),
  }

  if (!globalThis.process) {
    globalThis.process = buildLoProcessShim(manifest)
  } else {
    for (const [key, value] of Object.entries(sandboxEnv)) {
      globalThis.process.env[key] = value
    }
  }

  if (typeof globalThis.lo?.core?.chdir === 'function') {
    const changed = globalThis.lo.core.chdir(manifest.cwdHostPath)

    if (changed !== 0) {
      throw new Error(`sandbox bootstrap could not change directory to ${manifest.cwdHostPath}`)
    }
  }

  installLoConsoleShim()
}

export const getInstalledSandboxManifest = () => globalThis.__wonderlandsSandbox?.manifest ?? null
