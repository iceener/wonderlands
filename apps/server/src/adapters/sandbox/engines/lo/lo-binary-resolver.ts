import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'

export interface SandboxLoRuntimeConfig {
  binaryPath: string | null
  bootstrapEntry: string | null
}

export interface ResolvedSandboxLoRuntime {
  available: boolean
  binaryPath: string | null
  bootstrapEntryPath: string | null
  detail: string
}

const toAbsolutePath = (value: string, cwd: string): string =>
  isAbsolute(value) ? value : resolve(cwd, value)

const canExecute = (path: string): boolean => {
  try {
    accessSync(
      path,
      process.platform === 'win32' ? constants.F_OK : constants.F_OK | constants.X_OK,
    )
    return true
  } catch {
    return false
  }
}

const resolveBinaryFromPath = (): string | null => {
  const pathValue = process.env.PATH ?? ''
  const executableNames = process.platform === 'win32' ? ['lo.exe', 'lo.cmd', 'lo.bat'] : ['lo']

  for (const directory of pathValue.split(delimiter).filter((value) => value.length > 0)) {
    for (const executableName of executableNames) {
      const candidate = join(directory, executableName)

      if (canExecute(candidate)) {
        return candidate
      }
    }
  }

  return null
}

const resolveConfiguredBinary = (
  configuredBinaryPath: string | null,
  cwd: string,
): string | null => {
  if (!configuredBinaryPath) {
    return resolveBinaryFromPath()
  }

  const candidate = toAbsolutePath(configuredBinaryPath, cwd)
  return canExecute(candidate) ? candidate : null
}

const defaultBootstrapEntryCandidates = (cwd: string): string[] => [
  resolve(cwd, 'packages/sandbox-runtime-lo/dist/entry.mjs'),
  resolve(cwd, 'packages/sandbox-runtime-lo/dist/bootstrap/entry.mjs'),
]

const resolveBootstrapEntry = (
  configuredBootstrapEntry: string | null,
  cwd: string,
): string | null => {
  if (configuredBootstrapEntry) {
    const candidate = toAbsolutePath(configuredBootstrapEntry, cwd)
    return existsSync(candidate) ? candidate : null
  }

  for (const candidate of defaultBootstrapEntryCandidates(cwd)) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export const resolveSandboxLoRuntime = (
  config: SandboxLoRuntimeConfig,
  input: {
    cwd?: string
  } = {},
): ResolvedSandboxLoRuntime => {
  const cwd = input.cwd ?? process.cwd()
  const binaryPath = resolveConfiguredBinary(config.binaryPath, cwd)
  const bootstrapEntryPath = resolveBootstrapEntry(config.bootstrapEntry, cwd)
  const missingParts: string[] = []

  if (!binaryPath) {
    missingParts.push(
      config.binaryPath
        ? `configured lo binary was not found at ${toAbsolutePath(config.binaryPath, cwd)}`
        : 'no lo binary was found on PATH and SANDBOX_LO_BINARY is unset',
    )
  }

  if (!bootstrapEntryPath) {
    missingParts.push(
      config.bootstrapEntry
        ? `configured lo bootstrap entry was not found at ${toAbsolutePath(config.bootstrapEntry, cwd)}`
        : 'no lo bootstrap entry was found; build or point SANDBOX_LO_BOOTSTRAP_ENTRY at packages/sandbox-runtime-lo output',
    )
  }

  if (missingParts.length > 0) {
    return {
      available: false,
      binaryPath,
      bootstrapEntryPath,
      detail: `local_dev lo runtime is unavailable: ${missingParts.join('; ')}`,
    }
  }

  return {
    available: true,
    binaryPath,
    bootstrapEntryPath,
    detail: `local_dev lo runtime is available via ${binaryPath} with bootstrap ${bootstrapEntryPath}`,
  }
}
