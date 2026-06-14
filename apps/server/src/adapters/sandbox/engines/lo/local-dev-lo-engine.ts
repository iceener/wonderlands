import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type {
  PreparedSandboxExecution,
  SandboxRunFailure,
  SandboxRunFailureCode,
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
import { err, ok } from '../../../../shared/result'
import { resolveSandboxLoRuntime, type SandboxLoRuntimeConfig } from './lo-binary-resolver'
import {
  buildSandboxLoExecutionManifest,
  type SandboxLoExecutionManifest,
  type SandboxLoMcpBridgeManifest,
} from './lo-entrypoint-builder'

export interface LocalDevLoEngine {
  available: boolean
  detail: string
  runExecution: SandboxRunner['runExecution']
}

const MANIFEST_FILENAME = '.sandbox-lo-manifest.json'
const MCP_BRIDGE_POLL_INTERVAL_MS = 10
const reservedSandboxEnvKeys = new Set([
  'HOME',
  'PATH',
  'PWD',
  'SANDBOX_LO_MANIFEST_PATH',
  'TMPDIR',
])
const runtimeImportFromPattern = /(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g
const runtimeImportBarePattern = /(import\s+['"])(\.{1,2}\/[^'"]+)(['"])/g
const runtimeImportCallPattern = /(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g

const toSandboxRequest = (value: unknown): SandboxExecutionRequest =>
  value as SandboxExecutionRequest
const toSandboxPolicy = (value: unknown): SandboxPolicy => value as SandboxPolicy

const isReservedSandboxEnvKey = (value: string): boolean => {
  const normalized = value.trim().toUpperCase()

  return normalized.startsWith('SANDBOX_') || reservedSandboxEnvKeys.has(normalized)
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
    return 'sandbox-task.js'
  }

  return filename.endsWith('.js') || filename.endsWith('.mjs') ? filename : `${filename}.js`
}

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

const toHostPath = (hostRoot: string, sandboxPath: string): string =>
  join(hostRoot, sandboxPath.replace(/^\/+/, ''))

const collectRuntimeFiles = async (sourceDir: string): Promise<string[]> => {
  const entries = await readdir(sourceDir, {
    withFileTypes: true,
  })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = join(sourceDir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectRuntimeFiles(entryPath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(entryPath)
    }
  }

  return files
}

const rewriteRuntimeImportsToAbsolutePaths = async (runtimeRootHostPath: string) => {
  const runtimeFiles = await collectRuntimeFiles(runtimeRootHostPath)

  for (const filePath of runtimeFiles) {
    const source = await readFile(filePath, 'utf8')
    const rewrite = (_full: string, prefix: string, specifier: string, suffix: string) =>
      `${prefix}${resolve(dirname(filePath), specifier)}${suffix}`
    const rewritten = source
      .replaceAll(runtimeImportFromPattern, rewrite)
      .replaceAll(runtimeImportBarePattern, rewrite)
      .replaceAll(runtimeImportCallPattern, rewrite)

    if (rewritten !== source) {
      await writeFile(filePath, rewritten, 'utf8')
    }
  }
}

const stageLoRuntime = async (input: {
  bootstrapEntryPath: string
  workRootRef: string
}): Promise<{
  runtimeEntryHostPath: string
  runtimeRootHostPath: string
}> => {
  const sourceRuntimeRoot = dirname(input.bootstrapEntryPath)
  const runtimeRootHostPath = join(input.workRootRef, '.wonderlands', 'runtime-lo')
  const runtimeEntryHostPath = join(
    runtimeRootHostPath,
    relative(sourceRuntimeRoot, input.bootstrapEntryPath),
  )

  await cp(sourceRuntimeRoot, runtimeRootHostPath, {
    recursive: true,
  })
  await rewriteRuntimeImportsToAbsolutePaths(runtimeRootHostPath)

  return {
    runtimeEntryHostPath,
    runtimeRootHostPath,
  }
}

const renderBridgeResponse = (input: {
  error?: {
    message?: string
    type?: string
  }
  id: string
  ok: boolean
  result?: unknown
}): string =>
  JSON.stringify(
    input.ok
      ? {
          id: input.id,
          ok: true,
          result: input.result ?? null,
          type: 'wonderlands_mcp_response',
        }
      : {
          error: {
            message: input.error?.message ?? 'Unknown MCP bridge error',
            type: input.error?.type ?? 'conflict',
          },
          id: input.id,
          ok: false,
          type: 'wonderlands_mcp_response',
        },
  )

const writeBridgeResponseFile = async (input: { content: string; responsePath: string }) => {
  const temporaryPath = `${input.responsePath}.tmp`
  await writeFile(temporaryPath, input.content, 'utf8')
  await rename(temporaryPath, input.responsePath)
}

const createLoMcpBridgeManifest = async (
  workRootRef: string,
): Promise<SandboxLoMcpBridgeManifest> => {
  const bridgeRoot = join(workRootRef, '.wonderlands', 'mcp-bridge')
  const requestsDirHostPath = join(bridgeRoot, 'requests')
  const responsesDirHostPath = join(bridgeRoot, 'responses')

  await mkdir(requestsDirHostPath, { recursive: true })
  await mkdir(responsesDirHostPath, { recursive: true })

  return {
    pollIntervalMs: MCP_BRIDGE_POLL_INTERVAL_MS,
    requestsDirHostPath,
    responsesDirHostPath,
  }
}

const renderCombinedStderr = (input: {
  additionalStderrText: string | null
  capturedStderrText: string | null
  warnings: string[]
}): string | null => {
  const chunks = [
    ...input.warnings.map((warning) => `Warning: ${warning}`),
    input.additionalStderrText?.trim() ?? '',
    input.capturedStderrText?.trim() ?? '',
  ].filter((value) => value.length > 0)

  return chunks.length > 0 ? `${chunks.join('\n\n')}\n` : null
}

const toFailureSummary = (input: {
  exitCode: number | null
  phase: SandboxRunFailurePhase
  signal: string | null
}): string => {
  const phasePrefix =
    input.phase === 'runner_setup'
      ? 'Sandbox runner setup failed'
      : input.phase === 'script_execution'
        ? 'Sandbox script execution failed'
        : 'Sandbox package install failed'

  if (input.signal) {
    return `${phasePrefix} with signal ${input.signal}`
  }

  if (input.exitCode !== null) {
    return `${phasePrefix} with exit code ${input.exitCode}`
  }

  return phasePrefix
}

const toFailure = (input: {
  code?: SandboxRunFailureCode
  exitCode: number | null
  hint?: string | null
  message?: string
  nextAction?: string | null
  origin?: SandboxRunFailure['origin']
  phase: SandboxRunFailurePhase
  retryable?: boolean
  signal: string | null
  stderrText: string | null
  stdoutText: string | null
}): SandboxRunFailure => ({
  code:
    input.code ??
    (input.phase === 'runner_setup'
      ? 'SANDBOX_RUNNER_SETUP_FAILED'
      : input.phase === 'package_install'
        ? 'SANDBOX_POLICY_RUNTIME_UNSUPPORTED'
        : 'SANDBOX_GUEST_EXIT_NON_ZERO'),
  exitCode: input.exitCode,
  hint: input.hint ?? null,
  message:
    input.message ??
    toFailureSummary({
      exitCode: input.exitCode,
      phase: input.phase,
      signal: input.signal,
    }),
  nextAction: input.nextAction ?? input.hint ?? null,
  origin: input.origin ?? (input.phase === 'script_execution' ? 'guest' : 'control_plane'),
  phase: input.phase,
  retryable: input.retryable ?? input.phase !== 'runner_setup',
  runner: 'local_dev',
  signal: input.signal,
  stderrPreview: input.stderrText?.slice(0, 4000) ?? null,
  stdoutPreview: input.stdoutText?.slice(0, 4000) ?? null,
  summary: toFailureSummary({
    exitCode: input.exitCode,
    phase: input.phase,
    signal: input.signal,
  }),
})

const buildBlockedPackageResults = (
  execution: PreparedSandboxExecution,
  errorText: string,
): SandboxRunPackageResult[] =>
  execution.packages.map((requestedPackage) => ({
    errorText,
    id: requestedPackage.id,
    name: requestedPackage.name,
    requestedVersion: requestedPackage.requestedVersion,
    resolvedVersion: null,
    status: 'blocked',
  }))

export const createLocalDevLoEngine = (input: {
  config: SandboxLoRuntimeConfig
  logger: AppLogger
}): LocalDevLoEngine => {
  const runtime = resolveSandboxLoRuntime(input.config)

  return {
    available: runtime.available,
    detail: runtime.detail,
    runExecution: async (execution: PreparedSandboxExecution) => {
      if (!runtime.available || !runtime.binaryPath || !runtime.bootstrapEntryPath) {
        input.logger.warn(
          'lo sandbox execution was requested before the local_dev lo runtime was ready',
          {
            detail: runtime.detail,
            executionId: execution.executionId,
            runtime: execution.runtime,
            subsystem: 'sandbox_runner',
          },
        )

        return err({
          message: runtime.detail,
          type: 'conflict',
        })
      }

      const binaryPath = runtime.binaryPath
      const bootstrapEntryPath = runtime.bootstrapEntryPath
      const repoRootHostPath = resolve(dirname(bootstrapEntryPath), '../../..')

      const request = toSandboxRequest(execution.requestJson)
      const policy = toSandboxPolicy(execution.policySnapshotJson)
      const { filteredEnv, ignoredKeys } = filterSandboxEnv(request.env)
      const warnings = ignoredKeys.map((key) => `ignored reserved sandbox env key ${key}`)
      const networkMode: SandboxNetworkMode =
        request.network?.mode === 'on'
          ? request.network?.hosts?.length
            ? 'allow_list'
            : 'open'
          : 'off'
      const timeoutMs = Math.max(1000, policy.runtime.maxDurationSec * 1000)
      const deadlineAtMs = Date.now() + timeoutMs
      const startedAt = new Date().toISOString()
      const startedAtMs = Date.now()
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      const maxOutputBytes = Math.max(1, policy.runtime.maxOutputBytes)
      let stdoutBytes = 0
      let stderrBytes = 0
      let outputLimitExceeded = false

      const capture = (chunks: Buffer[], currentBytes: number, chunk: Buffer): number => {
        if (outputLimitExceeded || chunk.length === 0) {
          return currentBytes
        }

        const nextBytes = currentBytes + chunk.length

        if (nextBytes > maxOutputBytes) {
          outputLimitExceeded = true
          const remaining = Math.max(0, maxOutputBytes - currentBytes)

          if (remaining > 0) {
            chunks.push(chunk.subarray(0, remaining))
          }

          return maxOutputBytes
        }

        chunks.push(chunk)
        return nextBytes
      }

      const getCapturedStdoutText = (): string | null =>
        stdoutChunks.length > 0 ? Buffer.concat(stdoutChunks).toString('utf8') : null
      const getCapturedStderrText = (): string | null =>
        stderrChunks.length > 0 ? Buffer.concat(stderrChunks).toString('utf8') : null

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
            additionalStderrText: inputValue.additionalStderrText ?? null,
            capturedStderrText: getCapturedStderrText(),
            warnings,
          }),
          stdoutText: getCapturedStdoutText(),
          vaultAccessMode: 'none' as const,
        })

      if ((request.packages?.length ?? 0) > 0 || execution.packages.length > 0) {
        const errorText =
          'local_dev lo execution does not support requested packages yet. Use the Node compat runtime for package-backed jobs until lo package staging is implemented.'

        return await finish({
          errorText,
          failure: toFailure({
            code: 'SANDBOX_POLICY_RUNTIME_UNSUPPORTED',
            exitCode: null,
            hint: 'Remove packages from the request or allow Node compat fallback for this agent when package-backed execution is required.',
            message: errorText,
            nextAction:
              'Remove packages from this lo sandbox call, or rerun the request in Node compat mode.',
            origin: 'policy',
            phase: 'package_install',
            retryable: false,
            signal: null,
            stderrText: null,
            stdoutText: null,
          }),
          packages: buildBlockedPackageResults(execution, errorText),
          status: 'failed',
        })
      }

      if (networkMode !== 'off') {
        warnings.push(
          'network policy enforcement in local_dev lo mode depends on the configured lo bootstrap; verify that bootstrap before relying on lo network controls',
        )
      }

      const env = {
        ...filteredEnv,
        HOME: execution.hostRootRef,
        PATH: process.env.PATH ?? '',
        TMPDIR: join(execution.workRootRef, '.tmp'),
      }

      await mkdir(env.TMPDIR, { recursive: true })

      let entryHostPath: string

      try {
        if (request.source.kind === 'inline_script') {
          entryHostPath = toInlineEntryHostPath(execution.workRootRef, request.source.filename)
          await mkdir(dirname(entryHostPath), { recursive: true })
          await writeFile(entryHostPath, request.source.script, 'utf8')
        } else {
          entryHostPath = toHostPath(execution.hostRootRef, request.source.vaultPath)
        }
      } catch (error) {
        const errorText =
          error instanceof Error ? error.message : 'Unknown lo sandbox entry path failure'

        return await finish({
          errorText,
          failure: toFailure({
            exitCode: null,
            phase: 'runner_setup',
            signal: null,
            stderrText: null,
            stdoutText: null,
          }),
          status: 'failed',
        })
      }

      const cwdHostPath = request.cwdVaultPath
        ? toHostPath(execution.hostRootRef, request.cwdVaultPath)
        : request.source.kind === 'workspace_script'
          ? dirname(entryHostPath)
          : execution.workRootRef

      const mcpBridge = execution.mcpDispatcher
        ? await createLoMcpBridgeManifest(execution.workRootRef)
        : undefined

      const { runtimeEntryHostPath, runtimeRootHostPath } = await stageLoRuntime({
        bootstrapEntryPath,
        workRootRef: execution.workRootRef,
      })

      const manifest: SandboxLoExecutionManifest = buildSandboxLoExecutionManifest({
        cwdHostPath,
        entryHostPath,
        env: filteredEnv,
        execution,
        ...(mcpBridge ? { mcpBridge } : {}),
        policy,
        repoRootHostPath,
        request,
        runtimeRootHostPath,
      })
      const manifestPath = join(execution.hostRootRef, MANIFEST_FILENAME)

      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

      const childEnv = {
        ...env,
        SANDBOX_LO_MANIFEST_PATH: manifestPath,
        SANDBOX_LO_REPO_ROOT: repoRootHostPath,
        SANDBOX_LO_RUNTIME_ROOT: runtimeRootHostPath,
      }

      const ranScript = await new Promise<{
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
        let pollInFlight = false
        let bridgeInterval: NodeJS.Timeout | null = null
        const handledBridgeIds = new Set<string>()
        const child: ChildProcessWithoutNullStreams = spawn(
          binaryPath,
          [runtimeEntryHostPath, manifestPath],
          {
            cwd: runtimeRootHostPath,
            env: childEnv,
            stdio: 'pipe',
          },
        )

        const processBridgeRequests = async () => {
          if (!mcpBridge || !execution.mcpDispatcher || settled || pollInFlight) {
            return
          }

          pollInFlight = true

          try {
            const requestFilenames = await readdir(mcpBridge.requestsDirHostPath)

            for (const requestFilename of requestFilenames) {
              if (!requestFilename.endsWith('.json')) {
                continue
              }

              const requestId = requestFilename.slice(0, -'.json'.length)

              if (!requestId || handledBridgeIds.has(requestId)) {
                continue
              }

              handledBridgeIds.add(requestId)

              const requestPath = join(mcpBridge.requestsDirHostPath, requestFilename)
              const responsePath = join(mcpBridge.responsesDirHostPath, `${requestId}.json`)

              try {
                const requestJson = JSON.parse(await readFile(requestPath, 'utf8')) as {
                  args?: unknown
                  id?: unknown
                  runtimeName?: unknown
                  type?: unknown
                }

                if (
                  requestJson.type !== 'wonderlands_mcp_call' ||
                  typeof requestJson.id !== 'string' ||
                  typeof requestJson.runtimeName !== 'string'
                ) {
                  await writeBridgeResponseFile({
                    content: renderBridgeResponse({
                      error: {
                        message: 'Invalid MCP bridge request payload',
                        type: 'validation',
                      },
                      id: requestId,
                      ok: false,
                    }),
                    responsePath,
                  })
                  continue
                }

                const result = await execution.mcpDispatcher({
                  args: requestJson.args,
                  runtimeName: requestJson.runtimeName,
                })

                await writeBridgeResponseFile({
                  content: renderBridgeResponse(
                    result.ok
                      ? {
                          id: requestJson.id,
                          ok: true,
                          result: result.value,
                        }
                      : {
                          error: result.error,
                          id: requestJson.id,
                          ok: false,
                        },
                  ),
                  responsePath,
                })
              } catch (error) {
                await writeBridgeResponseFile({
                  content: renderBridgeResponse({
                    error: {
                      message:
                        error instanceof Error ? error.message : 'Unknown MCP bridge failure',
                      type: 'conflict',
                    },
                    id: requestId,
                    ok: false,
                  }),
                  responsePath,
                })
              } finally {
                await rm(requestPath, {
                  force: true,
                }).catch(() => undefined)
              }
            }
          } catch (error) {
            warnings.push(
              `lo MCP bridge polling failed: ${error instanceof Error ? error.message : 'unknown error'}`,
            )
          } finally {
            pollInFlight = false
          }
        }

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
          if (bridgeInterval) {
            clearInterval(bridgeInterval)
          }
          clearTimeout(timeoutHandle)
          resolvePromise(value)
        }

        child.stdout.on('data', (chunk: Buffer) => {
          stdoutBytes = capture(stdoutChunks, stdoutBytes, chunk)

          if (outputLimitExceeded) {
            child.kill('SIGKILL')
          }
        })

        child.stderr.on('data', (chunk: Buffer) => {
          stderrBytes = capture(stderrChunks, stderrBytes, chunk)

          if (outputLimitExceeded) {
            child.kill('SIGKILL')
          }
        })

        const timeoutHandle = setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, remainingTimeoutMs)

        if (mcpBridge && execution.mcpDispatcher) {
          bridgeInterval = setInterval(() => {
            void processBridgeRequests()
          }, mcpBridge.pollIntervalMs)
          void processBridgeRequests()
        }

        child.on('error', (error: Error) => {
          settle({
            code: null,
            signal: null,
            spawnError: error.message,
            timedOut: false,
          })
        })

        child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
          settle({
            code,
            signal,
            spawnError: null,
            timedOut,
          })
        })
      })

      if (ranScript.spawnError) {
        const failure = toFailure({
          exitCode: null,
          hint: 'Check SANDBOX_LO_BINARY and SANDBOX_LO_BOOTSTRAP_ENTRY before enabling lo.',
          phase: 'runner_setup',
          signal: null,
          stderrText: getCapturedStderrText(),
          stdoutText: getCapturedStdoutText(),
        })

        return await finish({
          errorText: `${failure.summary}. ${ranScript.spawnError}`,
          failure,
          status: 'failed',
        })
      }

      if (ranScript.timedOut) {
        const failure = toFailure({
          exitCode: null,
          phase: 'script_execution',
          signal: ranScript.signal,
          stderrText: getCapturedStderrText(),
          stdoutText: getCapturedStdoutText(),
        })

        return await finish({
          errorText: `${failure.summary}. Sandbox execution timed out after ${timeoutMs}ms.`,
          failure,
          status: 'failed',
        })
      }

      if (outputLimitExceeded) {
        const failure = toFailure({
          exitCode: null,
          phase: 'script_execution',
          signal: ranScript.signal,
          stderrText: getCapturedStderrText(),
          stdoutText: getCapturedStdoutText(),
        })

        return await finish({
          errorText: `${failure.summary}. Sandbox output exceeded ${maxOutputBytes} bytes.`,
          failure,
          status: 'failed',
        })
      }

      if ((ranScript.code ?? 1) !== 0) {
        const failure = toFailure({
          exitCode: ranScript.code ?? -1,
          phase: 'script_execution',
          signal: ranScript.signal,
          stderrText: getCapturedStderrText(),
          stdoutText: getCapturedStdoutText(),
        })

        return await finish({
          errorText: failure.summary,
          failure,
          status: 'failed',
        })
      }

      return await finish({
        errorText: null,
        status: 'completed',
      })
    },
  }
}
