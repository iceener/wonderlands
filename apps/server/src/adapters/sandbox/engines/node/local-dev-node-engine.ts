import { spawn } from 'node:child_process'
import { lstat, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type {
  PreparedSandboxExecution,
  SandboxRunFailure,
  SandboxRunFailureCode,
  SandboxRunFailureOrigin,
  SandboxRunFailurePhase,
  SandboxRunner,
  SandboxRunPackageResult,
} from '../../../../domain/sandbox/sandbox-runner'
import type {
  SandboxExecutionRequest,
  SandboxNetworkMode,
  SandboxPolicy,
} from '../../../../domain/sandbox/types'
import type { AppLogger } from '../../../../shared/logger'
import { ok } from '../../../../shared/result'

const PATH_SHIM_FILENAME = '.sandbox-path-shim.cjs'
const require = createRequire(import.meta.url)
const reservedSandboxEnvKeys = new Set([
  'HOME',
  'INIT_CWD',
  'NODE_NO_WARNINGS',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PATH',
  'PWD',
  'SANDBOX_HOST_ROOT',
  'SANDBOX_INPUT_DIR',
  'SANDBOX_OUTPUT_DIR',
  'SANDBOX_WORK_DIR',
  'TMPDIR',
])

const toSandboxRequest = (value: unknown): SandboxExecutionRequest =>
  value as SandboxExecutionRequest
const toSandboxPolicy = (value: unknown): SandboxPolicy => value as SandboxPolicy

const isReservedSandboxEnvKey = (value: string): boolean => {
  const normalized = value.trim().toUpperCase()

  return (
    reservedSandboxEnvKeys.has(normalized) ||
    normalized.startsWith('NPM_CONFIG_') ||
    normalized.startsWith('SANDBOX_')
  )
}

const filterSandboxEnv = (
  env: Record<string, string> | undefined,
): {
  filteredEnv: Record<string, string>
  ignoredKeys: string[]
} => {
  const filteredEnv: Record<string, string> = {}
  const ignoredKeys: string[] = []

  for (const [rawKey, rawValue] of Object.entries(env ?? {})) {
    const key = rawKey.trim()

    if (key.length === 0) {
      continue
    }

    if (isReservedSandboxEnvKey(key)) {
      ignoredKeys.push(key)
      continue
    }

    filteredEnv[key] = rawValue
  }

  return {
    filteredEnv,
    ignoredKeys,
  }
}

const toInlineScriptFilename = (filename: string | undefined): string => {
  if (!filename) {
    return 'sandbox-task.mjs'
  }

  return filename.endsWith('.js') || filename.endsWith('.mjs') || filename.endsWith('.cjs')
    ? filename
    : `${filename}.mjs`
}

const toHostPath = (hostRoot: string, sandboxPath: string): string =>
  join(hostRoot, sandboxPath.replace(/^\/+/, ''))

const ensureWithinRoot = (root: string, relativePath: string, label: string): string => {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, relativePath)
  const pathFromRoot = relative(resolvedRoot, resolvedPath).replace(/\\/g, '/')

  if (pathFromRoot === '..' || pathFromRoot.startsWith('../') || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} ${relativePath} escapes the sandbox work directory`)
  }

  return resolvedPath
}

const toInlineEntryHostPath = (workRootRef: string, filename: string | undefined): string =>
  ensureWithinRoot(workRootRef, toInlineScriptFilename(filename), 'inline script filename')

const toRegistryUrl = (value: string | null): string | null => {
  if (!value) {
    return null
  }

  const trimmed = value.trim().replace(/\/+$/, '')

  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return `${trimmed}/`
  }

  return `https://${trimmed}/`
}

const toPackageSpecifier = (name: string, version: string): string => `${name}@${version}`

const builtInSandboxPackageNames = ['just-bash'] as const

const toNodeModulesPackageJsonPath = (cwdHostPath: string, packageName: string): string =>
  join(cwdHostPath, 'node_modules', ...packageName.split('/'), 'package.json')

const resolveBuiltInSandboxPackage = (
  packageName: string,
): {
  nodeModulesRoot: string
  packageRoot: string
} | null => {
  try {
    let current = dirname(require.resolve(packageName))

    while (true) {
      const parent = dirname(current)

      if (basename(current) === packageName && basename(parent) === 'node_modules') {
        return {
          nodeModulesRoot: parent,
          packageRoot: current,
        }
      }

      if (parent === current) {
        return null
      }

      current = parent
    }
  } catch {
    return null
  }
}

const toSandboxRoot = (value: string): string | null => {
  const trimmed = value.trim()

  if (!trimmed.startsWith('/')) {
    return null
  }

  const segments = trimmed.split('/').filter(Boolean)
  return segments.length > 0 ? `/${segments[0]}` : '/'
}

const collectSandboxRoots = (request: SandboxExecutionRequest): string[] => {
  const roots = new Set<string>(['/input', '/work', '/output', '/vault', '/tmp'])

  const register = (value: string | undefined) => {
    if (!value) {
      return
    }

    const root = toSandboxRoot(value)

    if (root) {
      roots.add(root)
    }
  }

  for (const attachment of request.attachments ?? []) {
    register(attachment.mountPath)
  }

  for (const input of request.vaultInputs ?? []) {
    register(input.mountPath)
  }

  for (const writeback of request.outputs?.writeBack ?? []) {
    if ('fromPath' in writeback) {
      register(writeback.fromPath)
    }
  }

  for (const pattern of request.outputs?.attachGlobs ?? []) {
    register(pattern)
  }

  register(request.cwdVaultPath)

  if (request.source.kind === 'workspace_script') {
    register(request.source.vaultPath)
  }

  return Array.from(roots)
}

const buildPathShim = (hostRootRef: string, sandboxRoots: string[]): string =>
  `
const path = require('node:path');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const { syncBuiltinESMExports } = require('node:module');

const hostRoot = ${JSON.stringify(hostRootRef)};
const sandboxRoots = ${JSON.stringify(sandboxRoots)};

const remap = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  for (const root of sandboxRoots) {
    if (value === root || value.startsWith(root + '/')) {
      return path.join(hostRoot, value.replace(/^\\/+/, ''));
    }
  }

  return value;
};

const wrapOnePath = (target, key) => {
  if (typeof target[key] !== 'function') {
    return;
  }

  const original = target[key];
  target[key] = function (...args) {
    if (args.length > 0) {
      args[0] = remap(args[0]);
    }
    return original.apply(this, args);
  };
};

const wrapTwoPaths = (target, key) => {
  if (typeof target[key] !== 'function') {
    return;
  }

  const original = target[key];
  target[key] = function (...args) {
    if (args.length > 0) {
      args[0] = remap(args[0]);
    }
    if (args.length > 1) {
      args[1] = remap(args[1]);
    }
    return original.apply(this, args);
  };
};

[
  'access',
  'appendFile',
  'chmod',
  'chown',
  'existsSync',
  'lstat',
  'lstatSync',
  'mkdir',
  'mkdirSync',
  'open',
  'openSync',
  'opendir',
  'opendirSync',
  'readdir',
  'readdirSync',
  'readFile',
  'readFileSync',
  'readlink',
  'readlinkSync',
  'realpath',
  'realpathSync',
  'rm',
  'rmSync',
  'stat',
  'statSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'utimes',
  'utimesSync',
  'watch',
  'writeFile',
  'writeFileSync',
].forEach((key) => {
  wrapOnePath(fs, key);
  wrapOnePath(fsPromises, key);
});

[
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'link',
  'linkSync',
  'rename',
  'renameSync',
  'symlink',
  'symlinkSync',
].forEach((key) => {
  wrapTwoPaths(fs, key);
  wrapTwoPaths(fsPromises, key);
});

const originalChdir = process.chdir.bind(process);
process.chdir = (directory) => originalChdir(remap(directory));
syncBuiltinESMExports();
`.trim()

const ensurePackageManifest = async (cwdHostPath: string, executionId: string): Promise<void> => {
  const packageJsonPath = join(cwdHostPath, 'package.json')

  try {
    await stat(packageJsonPath)
  } catch {
    await writeFile(
      packageJsonPath,
      JSON.stringify(
        {
          name: `sandbox-${executionId}`,
          private: true,
        },
        null,
        2,
      ),
      'utf8',
    )
  }
}

const ensureBuiltInSandboxPackages = async (
  cwdHostPath: string,
): Promise<{
  additionalReadRoots: string[]
}> => {
  const additionalReadRoots = new Set<string>()
  const nodeModulesDir = join(cwdHostPath, 'node_modules')
  await mkdir(nodeModulesDir, { recursive: true })

  for (const packageName of builtInSandboxPackageNames) {
    const resolved = resolveBuiltInSandboxPackage(packageName)

    if (!resolved) {
      continue
    }

    additionalReadRoots.add(resolved.nodeModulesRoot)

    const linkPath = join(nodeModulesDir, ...packageName.split('/'))
    await mkdir(dirname(linkPath), { recursive: true })

    try {
      await lstat(linkPath)
      continue
    } catch {
      // create the symlink below
    }

    await symlink(resolved.packageRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  }

  return {
    additionalReadRoots: Array.from(additionalReadRoots),
  }
}

const readResolvedPackageVersion = async (
  cwdHostPath: string,
  packageName: string,
): Promise<string | null> => {
  try {
    const parsed = JSON.parse(
      await readFile(toNodeModulesPackageJsonPath(cwdHostPath, packageName), 'utf8'),
    ) as { version?: unknown }

    return typeof parsed.version === 'string' && parsed.version.trim().length > 0
      ? parsed.version.trim()
      : null
  } catch {
    return null
  }
}

const renderCombinedStderr = (input: {
  additionalStderrText?: string | null
  capturedStderrText: string | null
  warnings: string[]
}): string | null => {
  const parts = [
    input.additionalStderrText?.trim() || '',
    input.capturedStderrText?.trim() || '',
    ...input.warnings.map((warning) => `[local_dev sandbox warning] ${warning}`),
  ].filter((value) => value.length > 0)

  return parts.length > 0 ? parts.join('\n\n') : null
}

const FAILURE_PREVIEW_LIMIT = 1200

const toPreview = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? ''

  if (trimmed.length === 0) {
    return null
  }

  return trimmed.length <= FAILURE_PREVIEW_LIMIT
    ? trimmed
    : `${trimmed.slice(0, FAILURE_PREVIEW_LIMIT)}…`
}

const classifyFailure = (input: {
  phase: SandboxRunFailurePhase
  requestedPackageCount: number
  stderrPreview: string | null
  stdoutPreview: string | null
}): {
  code: SandboxRunFailureCode
  hint: string | null
  origin: SandboxRunFailureOrigin
  retryable: boolean
} => {
  if (input.phase === 'package_install' && input.requestedPackageCount > 0) {
    return {
      code: 'SANDBOX_PACKAGE_INSTALL_FAILED',
      hint: 'This local_dev runner installs npm packages with --ignore-scripts. Packages that need install-time setup, postinstall hooks, or native binaries, such as sharp, may be blocked or fail here. Prefer pure-JS packages or a managed sandbox runner.',
      origin: 'control_plane',
      retryable: true,
    }
  }

  const combinedPreview = `${input.stderrPreview ?? ''}\n${input.stdoutPreview ?? ''}`.toLowerCase()

  if (
    combinedPreview.includes('syntaxerror:') &&
    /\n\s*(?:import|export)\s/m.test(`${input.stderrPreview ?? ''}\n${input.stdoutPreview ?? ''}`)
  ) {
    return {
      code: 'SANDBOX_VALIDATION_IMPORT_EXPORT_IN_SCRIPT_BODY',
      hint: 'This script body cannot use static top-level `import`/`export` syntax. Use `await import(...)` inside the script body instead, for example `const { default: sharp } = await import("sharp")` or `const { promises: fs } = await import("node:fs")`.',
      origin: 'guest',
      retryable: true,
    }
  }

  if (
    combinedPreview.includes('cannot find module') ||
    combinedPreview.includes('module not found') ||
    combinedPreview.includes('err_module_not_found')
  ) {
    return {
      code: 'SANDBOX_SCRIPT_IMPORT_FAILED',
      hint:
        input.requestedPackageCount > 0
          ? 'A requested package could not be loaded at runtime. In local_dev this usually means the package needs install-time setup or native binaries, such as sharp, and is incompatible with the active runner. Prefer a pure-JS package or a managed sandbox runner.'
          : 'A script import could not be loaded at runtime. Check the requested packages and script import paths.',
      origin: 'guest',
      retryable: true,
    }
  }

  if (
    combinedPreview.includes('require is not defined in es module scope') ||
    combinedPreview.includes('require is not defined')
  ) {
    return {
      code: 'SANDBOX_VALIDATION_REQUIRE_IN_ESM',
      hint: 'The inline script is running as an ES module. Use `await import(...)` instead of `require(...)`, or provide a `.cjs` filename when the script must run as CommonJS.',
      origin: 'guest',
      retryable: true,
    }
  }

  if (
    combinedPreview.includes('illegal return statement') ||
    combinedPreview.includes('return statement is not allowed here')
  ) {
    return {
      code: 'SANDBOX_VALIDATION_TOP_LEVEL_RETURN',
      hint: 'Do not use top-level `return` in inline script mode. Use top-level await for the work, then print the final result with `console.log(JSON.stringify(result))`.',
      origin: 'guest',
      retryable: true,
    }
  }

  if (combinedPreview.includes('enoent') || combinedPreview.includes('no such file or directory')) {
    return {
      code: 'SANDBOX_PATH_NOT_MOUNTED',
      hint: 'The script referenced a path that is not present in the sandbox. Mount it first with attachments, garden, vaultInputs, or cwdVaultPath.',
      origin: 'guest',
      retryable: true,
    }
  }

  if (
    combinedPreview.includes('permission denied') ||
    combinedPreview.includes('access to this api has been restricted') ||
    combinedPreview.includes('err_access_denied')
  ) {
    return {
      code: 'SANDBOX_PERMISSION_DENIED',
      hint:
        input.requestedPackageCount > 0
          ? 'The script attempted an operation blocked by sandbox permissions or the Node permission model. In local_dev, requested packages that rely on native addons or install-time setup, such as sharp, may fail at runtime; prefer pure-JS packages or a managed sandbox runner.'
          : 'The script attempted an operation blocked by sandbox permissions or the Node permission model.',
      origin: 'guest',
      retryable: true,
    }
  }

  return {
    code:
      input.phase === 'runner_setup'
        ? 'SANDBOX_RUNNER_SETUP_FAILED'
        : input.phase === 'package_install'
          ? 'SANDBOX_PACKAGE_INSTALL_FAILED'
          : 'SANDBOX_GUEST_EXIT_NON_ZERO',
    hint: null,
    origin: input.phase === 'script_execution' ? 'guest' : 'control_plane',
    retryable: input.phase !== 'runner_setup',
  }
}

const formatFailureSummary = (input: {
  exitCode: number | null
  hint: string | null
  phase: SandboxRunFailurePhase
}): string => {
  const parts = [
    `Sandbox ${input.phase.replaceAll('_', ' ')} failed`,
    input.exitCode !== null ? `with exit code ${input.exitCode}` : null,
  ].filter((value): value is string => value !== null)

  return input.hint ? `${parts.join(' ')}. ${input.hint}` : parts.join(' ')
}

const toFailure = (input: {
  code?: SandboxRunFailureCode
  exitCode: number | null
  hint?: string | null
  message?: string
  nextAction?: string | null
  origin?: SandboxRunFailureOrigin
  phase: SandboxRunFailurePhase
  requestedPackageCount: number
  retryable?: boolean
  signal: string | null
  stderrText: string | null
  stdoutText: string | null
}): SandboxRunFailure => {
  const stderrPreview = toPreview(input.stderrText)
  const stdoutPreview = toPreview(input.stdoutText)
  const classified = classifyFailure({
    phase: input.phase,
    requestedPackageCount: input.requestedPackageCount,
    stderrPreview,
    stdoutPreview,
  })
  const hint = input.hint ?? classified.hint

  return {
    code: input.code ?? classified.code,
    exitCode: input.exitCode,
    hint,
    message:
      input.message ??
      formatFailureSummary({
        exitCode: input.exitCode,
        hint,
        phase: input.phase,
      }),
    nextAction: input.nextAction ?? hint,
    origin: input.origin ?? classified.origin,
    phase: input.phase,
    retryable: input.retryable ?? classified.retryable,
    runner: 'local_dev',
    signal: input.signal,
    stderrPreview,
    stdoutPreview,
    summary: formatFailureSummary({
      exitCode: input.exitCode,
      hint,
      phase: input.phase,
    }),
  }
}

const buildPackageResults = async (
  cwdHostPath: string,
  packages: PreparedSandboxExecution['packages'],
  options:
    | {
        errorText: string
        forceStatus: 'blocked' | 'failed'
      }
    | undefined,
): Promise<SandboxRunPackageResult[]> => {
  const results: SandboxRunPackageResult[] = []

  for (const requestedPackage of packages) {
    const resolvedVersion = await readResolvedPackageVersion(cwdHostPath, requestedPackage.name)
    const installed = resolvedVersion !== null

    results.push({
      errorText: installed ? null : (options?.errorText ?? null),
      id: requestedPackage.id,
      name: requestedPackage.name,
      requestedVersion: requestedPackage.requestedVersion,
      resolvedVersion,
      status: installed ? 'installed' : (options?.forceStatus ?? 'failed'),
    })
  }

  return results
}

export interface LocalDevSandboxEngine {
  runExecution: SandboxRunner['runExecution']
}

export const createLocalDevNodeEngine = (input: { logger: AppLogger }): LocalDevSandboxEngine => ({
  runExecution: async (execution) => {
    const request = toSandboxRequest(execution.requestJson)
    const policy = toSandboxPolicy(execution.policySnapshotJson)
    const networkMode = ((request as { network?: { mode?: SandboxNetworkMode } }).network?.mode ??
      'off') as SandboxNetworkMode
    const startedAt = new Date().toISOString()
    const startedAtMs = Date.parse(startedAt)
    const timeoutMs = Math.max(1, policy.runtime.maxDurationSec) * 1000
    const deadlineAtMs = startedAtMs + timeoutMs
    const maxOutputBytes = Math.max(1024, policy.runtime.maxOutputBytes)
    const requestedPackages = execution.packages
    const sandboxRoots = collectSandboxRoots(request)
    const warnings: string[] = []
    const shimPath = join(execution.hostRootRef, PATH_SHIM_FILENAME)
    const { filteredEnv: requestEnv, ignoredKeys: ignoredEnvKeys } = filterSandboxEnv(request.env)
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let outputLimitExceeded = false

    warnings.push(...ignoredEnvKeys.map((key) => `ignored reserved sandbox env key ${key}`))

    const capture = (target: Buffer[], currentBytes: number, chunk: Buffer): number => {
      if (outputLimitExceeded) {
        return currentBytes
      }

      const nextBytes = currentBytes + chunk.byteLength

      if (nextBytes > maxOutputBytes) {
        const remaining = Math.max(0, maxOutputBytes - currentBytes)

        if (remaining > 0) {
          target.push(chunk.subarray(0, remaining))
        }

        outputLimitExceeded = true
        return maxOutputBytes
      }

      target.push(chunk)
      return nextBytes
    }

    const getCapturedStdoutText = (): string | null =>
      Buffer.concat(stdoutChunks).toString('utf8') || null

    const getCapturedStderrText = (): string | null =>
      Buffer.concat(stderrChunks).toString('utf8') || null

    const finish = async (inputValue: {
      additionalStderrText?: string | null
      errorText: string | null
      failure?: SandboxRunFailure | null
      packages?: SandboxRunPackageResult[]
      status: 'cancelled' | 'completed' | 'failed'
    }) =>
      ok({
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        errorText: inputValue.errorText,
        externalSandboxId: null,
        failure: inputValue.failure ?? null,
        networkMode,
        packages: inputValue.packages ?? [],
        provider: 'local_dev' as const,
        runtime: execution.runtime,
        startedAt,
        status: inputValue.status,
        stderrText: renderCombinedStderr({
          additionalStderrText: inputValue.additionalStderrText,
          capturedStderrText: getCapturedStderrText(),
          warnings,
        }),
        stdoutText: getCapturedStdoutText(),
        vaultAccessMode: 'none' as const,
      })

    const env = {
      ...requestEnv,
      HOME: execution.hostRootRef,
      NODE_NO_WARNINGS: '1',
      PATH: process.env.PATH ?? '',
      SANDBOX_HOST_ROOT: execution.hostRootRef,
      SANDBOX_INPUT_DIR: execution.inputRootRef,
      SANDBOX_OUTPUT_DIR: execution.outputRootRef,
      SANDBOX_WORK_DIR: execution.workRootRef,
      TMPDIR: join(execution.workRootRef, '.tmp'),
    }

    if (networkMode !== 'off') {
      warnings.push(
        'network policy is not enforced by the local_dev runner; execution continues in best-effort mode',
      )
    }

    await Promise.all(
      sandboxRoots
        .filter((root) => root !== '/')
        .map(async (root) => {
          await mkdir(toHostPath(execution.hostRootRef, root), { recursive: true })
        }),
    )
    await mkdir(env.TMPDIR, { recursive: true })
    await writeFile(shimPath, buildPathShim(execution.hostRootRef, sandboxRoots), 'utf8')

    let entryHostPath: string

    if (request.source.kind === 'inline_script') {
      try {
        entryHostPath = toInlineEntryHostPath(execution.workRootRef, request.source.filename)
      } catch (error) {
        const errorText =
          error instanceof Error ? error.message : 'Unknown sandbox entry path failure'

        return await finish({
          errorText,
          failure: {
            code: 'SANDBOX_RUNNER_SETUP_FAILED',
            exitCode: null,
            hint: null,
            message: errorText,
            nextAction: null,
            origin: 'control_plane',
            phase: 'runner_setup',
            retryable: false,
            runner: 'local_dev',
            signal: null,
            stderrPreview: null,
            stdoutPreview: null,
            summary: errorText,
          },
          packages: await buildPackageResults(execution.workRootRef, requestedPackages, {
            errorText,
            forceStatus: 'failed',
          }),
          status: 'failed',
        })
      }

      await mkdir(dirname(entryHostPath), { recursive: true })
      await writeFile(entryHostPath, request.source.script, 'utf8')
    } else {
      entryHostPath = toHostPath(execution.hostRootRef, request.source.vaultPath)
    }

    const cwdHostPath = request.cwdVaultPath
      ? toHostPath(execution.hostRootRef, request.cwdVaultPath)
      : request.source.kind === 'workspace_script'
        ? dirname(entryHostPath)
        : execution.workRootRef

    const runChildProcess = async (
      command: string,
      args: string[],
      childEnv: Record<string, string>,
    ) =>
      await new Promise<{
        code: number | null
        signal: NodeJS.Signals | null
        spawnError: string | null
        timedOut: boolean
      }>((resolvePromise) => {
        const remainingTimeoutMs = Math.max(1, deadlineAtMs - Date.now())

        if (remainingTimeoutMs <= 1) {
          resolvePromise({
            code: null,
            signal: 'SIGKILL',
            spawnError: null,
            timedOut: true,
          })
          return
        }

        let settled = false
        let timedOut = false
        const child = spawn(command, args, {
          cwd: cwdHostPath,
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        })

        const settle = (value: {
          code: number | null
          signal: NodeJS.Signals | null
          spawnError: string | null
          timedOut: boolean
        }) => {
          if (settled) {
            return
          }

          settled = true
          clearTimeout(timeoutHandle)
          resolvePromise(value)
        }

        child.stdout?.on('data', (chunk: Buffer) => {
          stdoutBytes = capture(stdoutChunks, stdoutBytes, chunk)

          if (outputLimitExceeded) {
            child.kill('SIGKILL')
          }
        })

        child.stderr?.on('data', (chunk: Buffer) => {
          stderrBytes = capture(stderrChunks, stderrBytes, chunk)

          if (outputLimitExceeded) {
            child.kill('SIGKILL')
          }
        })

        child.on('message', (message: unknown) => {
          if (
            !execution.mcpDispatcher ||
            !message ||
            typeof message !== 'object' ||
            (message as { type?: unknown }).type !== 'wonderlands_mcp_call'
          ) {
            return
          }

          const request = message as {
            args?: unknown
            id?: unknown
            runtimeName?: unknown
            type: 'wonderlands_mcp_call'
          }

          if (typeof request.id !== 'string' || typeof request.runtimeName !== 'string') {
            return
          }

          void execution
            .mcpDispatcher({
              args: request.args,
              runtimeName: request.runtimeName,
            })
            .then((result) => {
              if (settled || !child.connected) {
                return
              }

              child.send({
                ...(result.ok
                  ? {
                      ok: true,
                      result: result.value,
                    }
                  : {
                      error: result.error,
                      ok: false,
                    }),
                id: request.id,
                type: 'wonderlands_mcp_response',
              })
            })
            .catch((error) => {
              if (settled || !child.connected) {
                return
              }

              child.send({
                error: {
                  message: error instanceof Error ? error.message : 'Unknown MCP bridge failure',
                  type: 'conflict',
                },
                id: request.id,
                ok: false,
                type: 'wonderlands_mcp_response',
              })
            })
        })

        const timeoutHandle = setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, remainingTimeoutMs)

        child.on('error', (error) => {
          settle({
            code: null,
            signal: null,
            spawnError: error.message,
            timedOut: false,
          })
        })

        child.on('close', (code, signal) => {
          settle({
            code,
            signal,
            spawnError: null,
            timedOut,
          })
        })
      })

    if (requestedPackages.length > 0 && networkMode === 'off') {
      const failure = toFailure({
        exitCode: null,
        phase: 'package_install',
        requestedPackageCount: requestedPackages.length,
        signal: null,
        stderrText: null,
        stdoutText: null,
      })

      return await finish({
        errorText: `${failure.summary}. Package installation requires sandbox network access.`,
        failure: {
          ...failure,
          code: 'SANDBOX_PACKAGE_INSTALL_REQUIRES_NETWORK',
          hint: 'Enable sandbox network access for package installation, or remove packages from this execute call.',
          message: `${failure.summary}. Package installation requires sandbox network access.`,
          nextAction:
            'Rerun the sandbox call with package installation network access, or remove requested packages.',
          origin: 'policy',
          retryable: false,
          summary: `${failure.summary}. Enable sandbox network access for package installation.`,
        },
        packages: await buildPackageResults(cwdHostPath, requestedPackages, {
          errorText: 'package installation requires sandbox network access',
          forceStatus: 'blocked',
        }),
        status: 'failed',
      })
    }

    if (requestedPackages.some((pkg) => pkg.installScriptsAllowed)) {
      const failure = toFailure({
        exitCode: null,
        phase: 'package_install',
        requestedPackageCount: requestedPackages.length,
        signal: null,
        stderrText: null,
        stdoutText: null,
      })

      return await finish({
        errorText: `${failure.summary}. local_dev sandbox runner does not support packages that need install scripts, postinstall setup, or native binaries, such as sharp. Prefer pure-JS packages or a managed sandbox runner.`,
        failure: {
          ...failure,
          code: 'SANDBOX_POLICY_INSTALL_SCRIPTS_BLOCKED',
          hint: 'local_dev installs packages with --ignore-scripts and blocks packages that require install scripts, postinstall setup, or native binaries. Prefer a pure-JS package or a managed sandbox runner.',
          message: `${failure.summary}. local_dev sandbox runner does not support packages that need install scripts, postinstall setup, or native binaries, such as sharp. Prefer pure-JS packages or a managed sandbox runner.`,
          nextAction:
            'Replace the package with a pure-JS alternative, or rerun the task in a managed sandbox runner.',
          origin: 'policy',
          retryable: false,
          summary: `${failure.summary}. local_dev blocks packages that need install scripts or native binaries.`,
        },
        packages: await buildPackageResults(cwdHostPath, requestedPackages, {
          errorText:
            'local dev sandbox runner does not support packages that need install scripts, postinstall setup, or native binaries',
          forceStatus: 'blocked',
        }),
        status: 'failed',
      })
    }

    if (networkMode === 'allow_list' && requestedPackages.length > 0) {
      const registryHosts = Array.from(
        new Set(
          requestedPackages
            .map((requestedPackage) => requestedPackage.registryHost?.trim() ?? '')
            .filter((value) => value.length > 0),
        ),
      )

      if (registryHosts.length !== 1) {
        const failure = toFailure({
          exitCode: null,
          phase: 'package_install',
          requestedPackageCount: requestedPackages.length,
          signal: null,
          stderrText: null,
          stdoutText: null,
        })

        return await finish({
          errorText: `${failure.summary}. The active runner requires exactly one allowed package registry when network mode is allow_list.`,
          failure,
          packages: await buildPackageResults(cwdHostPath, requestedPackages, {
            errorText:
              'local dev sandbox runner requires exactly one allowed package registry when network mode is allow_list',
            forceStatus: 'blocked',
          }),
          status: 'failed',
        })
      }
    }

    const npmCacheDir = join(execution.workRootRef, '.npm-cache')
    await mkdir(npmCacheDir, { recursive: true })
    await ensurePackageManifest(cwdHostPath, execution.executionId)

    if (requestedPackages.length > 0) {
      const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const registryUrl = toRegistryUrl(requestedPackages[0]?.registryHost ?? null)
      const npmEnv = {
        ...env,
        npm_config_audit: 'false',
        npm_config_cache: npmCacheDir,
        npm_config_fund: 'false',
        npm_config_package_lock: 'false',
        npm_config_update_notifier: 'false',
        ...(registryUrl ? { npm_config_registry: registryUrl } : {}),
      }
      const npmArgs = [
        'install',
        '--no-save',
        '--package-lock=false',
        '--ignore-scripts',
        ...requestedPackages.map((requestedPackage) =>
          toPackageSpecifier(requestedPackage.name, requestedPackage.requestedVersion),
        ),
      ]

      input.logger.info('Installing sandbox packages with local dev runner', {
        cwdHostPath,
        executionId: execution.executionId,
        packages: requestedPackages.map((requestedPackage) =>
          toPackageSpecifier(requestedPackage.name, requestedPackage.requestedVersion),
        ),
        registryUrl,
        subsystem: 'sandbox_runner',
      })

      const installed = await runChildProcess(npmCommand, npmArgs, npmEnv)

      if (installed.spawnError) {
        const failure = toFailure({
          exitCode: null,
          phase: 'package_install',
          requestedPackageCount: requestedPackages.length,
          signal: null,
          stderrText: getCapturedStderrText(),
          stdoutText: getCapturedStdoutText(),
        })

        return await finish({
          errorText: `${failure.summary}. Sandbox package install failed: ${installed.spawnError}`,
          failure,
          packages: await buildPackageResults(cwdHostPath, requestedPackages, {
            errorText: `sandbox package install failed: ${installed.spawnError}`,
            forceStatus: 'failed',
          }),
          status: 'failed',
        })
      }

      if (installed.timedOut) {
        const failure = toFailure({
          code: 'SANDBOX_EXECUTION_TIMEOUT',
          exitCode: null,
          hint: `The package install step exceeded the sandbox timeout of ${timeoutMs}ms.`,
          message: `Sandbox package installation timed out after ${timeoutMs}ms.`,
          nextAction:
            'Retry with fewer packages, a smaller package set, or a managed sandbox runner.',
          origin: 'control_plane',
          phase: 'package_install',
          requestedPackageCount: requestedPackages.length,
          retryable: true,
          signal: installed.signal,
          stderrText: getCapturedStderrText(),
          stdoutText: getCapturedStdoutText(),
        })

        return await finish({
          errorText: `${failure.summary}. Sandbox execution timed out after ${timeoutMs}ms.`,
          failure,
          packages: await buildPackageResults(cwdHostPath, requestedPackages, {
            errorText: `sandbox execution timed out after ${timeoutMs}ms`,
            forceStatus: 'failed',
          }),
          status: 'failed',
        })
      }

      if (outputLimitExceeded) {
        const failure = toFailure({
          code: 'SANDBOX_OUTPUT_LIMIT_EXCEEDED',
          exitCode: null,
          hint: `The package install step wrote more than the sandbox output limit of ${maxOutputBytes} bytes.`,
          message: `Sandbox package installation exceeded ${maxOutputBytes} bytes of output.`,
          nextAction: 'Reduce install verbosity or split the work across smaller sandbox runs.',
          origin: 'control_plane',
          phase: 'package_install',
          requestedPackageCount: requestedPackages.length,
          retryable: true,
          signal: installed.signal,
          stderrText: getCapturedStderrText(),
          stdoutText: getCapturedStdoutText(),
        })

        return await finish({
          errorText: `${failure.summary}. Sandbox output exceeded ${maxOutputBytes} bytes.`,
          failure,
          packages: await buildPackageResults(cwdHostPath, requestedPackages, {
            errorText: `sandbox output exceeded ${maxOutputBytes} bytes`,
            forceStatus: 'failed',
          }),
          status: 'failed',
        })
      }

      if ((installed.code ?? 1) !== 0) {
        const failure = toFailure({
          exitCode: installed.code ?? -1,
          phase: 'package_install',
          requestedPackageCount: requestedPackages.length,
          signal: installed.signal,
          stderrText: getCapturedStderrText(),
          stdoutText: getCapturedStdoutText(),
        })

        return await finish({
          errorText: failure.summary,
          failure,
          packages: await buildPackageResults(cwdHostPath, requestedPackages, {
            errorText: `sandbox package install exited with code ${installed.code ?? -1}`,
            forceStatus: 'failed',
          }),
          status: 'failed',
        })
      }
    }

    const builtInPackages = await ensureBuiltInSandboxPackages(cwdHostPath)
    const needsAddonAccess = requestedPackages.length > 0 || execution.packages.length > 0

    const nodeArgs = [
      '--permission',
      ...(needsAddonAccess ? ['--allow-addons'] : []),
      `--allow-fs-read=${execution.hostRootRef}`,
      ...builtInPackages.additionalReadRoots.map((root) => `--allow-fs-read=${root}`),
      `--allow-fs-write=${execution.hostRootRef}`,
      `--max-old-space-size=${Math.max(16, policy.runtime.maxMemoryMb)}`,
      '--require',
      shimPath,
      entryHostPath,
      ...(request.args ?? []),
    ]

    input.logger.info('Executing sandbox job with local dev runner', {
      cwdHostPath,
      entryHostPath,
      executionId: execution.executionId,
      subsystem: 'sandbox_runner',
    })

    const ranScript = await runChildProcess(process.execPath, nodeArgs, env)

    if (ranScript.spawnError) {
      const failure = toFailure({
        exitCode: null,
        phase: 'script_execution',
        requestedPackageCount: requestedPackages.length,
        signal: null,
        stderrText: getCapturedStderrText(),
        stdoutText: getCapturedStdoutText(),
      })

      return await finish({
        errorText: `${failure.summary}. ${ranScript.spawnError}`,
        failure,
        packages: await buildPackageResults(cwdHostPath, requestedPackages, undefined),
        status: 'failed',
      })
    }

    if (ranScript.timedOut) {
      const failure = toFailure({
        code: 'SANDBOX_EXECUTION_TIMEOUT',
        exitCode: null,
        hint: `The script exceeded the sandbox timeout of ${timeoutMs}ms.`,
        message: `Sandbox script execution timed out after ${timeoutMs}ms.`,
        nextAction: 'Reduce the work in the script or split it across smaller sandbox calls.',
        origin: 'guest',
        phase: 'script_execution',
        requestedPackageCount: requestedPackages.length,
        retryable: true,
        signal: ranScript.signal,
        stderrText: getCapturedStderrText(),
        stdoutText: getCapturedStdoutText(),
      })

      return await finish({
        errorText: `${failure.summary}. Sandbox execution timed out after ${timeoutMs}ms.`,
        failure,
        packages: await buildPackageResults(cwdHostPath, requestedPackages, undefined),
        status: 'failed',
      })
    }

    if (outputLimitExceeded) {
      const failure = toFailure({
        code: 'SANDBOX_OUTPUT_LIMIT_EXCEEDED',
        exitCode: null,
        hint: `The script wrote more than the sandbox output limit of ${maxOutputBytes} bytes.`,
        message: `Sandbox script execution exceeded ${maxOutputBytes} bytes of output.`,
        nextAction:
          'Reduce console output or write large artifacts to files under /output instead.',
        origin: 'guest',
        phase: 'script_execution',
        requestedPackageCount: requestedPackages.length,
        retryable: true,
        signal: ranScript.signal,
        stderrText: getCapturedStderrText(),
        stdoutText: getCapturedStdoutText(),
      })

      return await finish({
        errorText: `${failure.summary}. Sandbox output exceeded ${maxOutputBytes} bytes.`,
        failure,
        packages: await buildPackageResults(cwdHostPath, requestedPackages, undefined),
        status: 'failed',
      })
    }

    if ((ranScript.code ?? 1) !== 0) {
      const failure = toFailure({
        exitCode: ranScript.code ?? -1,
        phase: 'script_execution',
        requestedPackageCount: requestedPackages.length,
        signal: ranScript.signal,
        stderrText: getCapturedStderrText(),
        stdoutText: getCapturedStdoutText(),
      })

      return await finish({
        errorText: failure.summary,
        failure,
        packages: await buildPackageResults(cwdHostPath, requestedPackages, undefined),
        status: 'failed',
      })
    }

    return await finish({
      errorText: null,
      packages: await buildPackageResults(cwdHostPath, requestedPackages, undefined),
      status: 'completed',
    })
  },
})
