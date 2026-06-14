import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

import { createLocalDevSandboxRunner } from '../../src/adapters/sandbox/local-dev/local-dev-sandbox-runner'
import { renderMcpCodeModeWrapperScript } from '../../src/application/mcp/code-mode'
import type { PreparedSandboxExecution } from '../../src/domain/sandbox/sandbox-runner'
import { createLogger } from '../../src/shared/logger'

class MockChildProcess extends EventEmitter {
  connected = true
  send = vi.fn()
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn()
}

const createPreparedExecution = async (
  overrides: Partial<PreparedSandboxExecution> = {},
): Promise<PreparedSandboxExecution> => {
  const hostRootRef = await mkdtemp(join(tmpdir(), 'wl-sandbox-runner-'))
  const inputRootRef = join(hostRootRef, 'input')
  const outputRootRef = join(hostRootRef, 'output')
  const workRootRef = join(hostRootRef, 'work')

  await mkdir(inputRootRef, { recursive: true })
  await mkdir(outputRootRef, { recursive: true })
  await mkdir(workRootRef, { recursive: true })

  return {
    executionId: 'sbx_test_runner',
    hostRootRef,
    inputRootRef,
    outputRootRef,
    packages: [],
    policySnapshotJson: {
      enabled: true,
      network: {
        mode: 'allow_list',
      },
      packages: {
        allowedRegistries: ['registry.npmjs.org'],
        mode: 'allow_list',
      },
      runtime: {
        allowWorkspaceScripts: true,
        maxDurationSec: 10,
        maxInputBytes: 1_000_000,
        maxMemoryMb: 128,
        maxOutputBytes: 1_000_000,
        nodeVersion: '22',
      },
      vault: {
        mode: 'read_only',
      },
    },
    requestJson: {
      network: {
        allowedHosts: ['registry.npmjs.org'],
        mode: 'allow_list',
      },
      runtime: 'node',
      source: {
        filename: 'task.mjs',
        kind: 'inline_script',
        script: 'console.log("sandbox script")',
      },
      task: 'Test sandbox runner',
      vaultAccess: 'read_only',
    },
    runtime: 'node',
    workRootRef,
    ...overrides,
  }
}

describe('local dev sandbox runner', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('advertises lo support when configured lo runtime assets exist', async () => {
    const loRuntimeRoot = await mkdtemp(join(tmpdir(), 'wl-lo-runtime-'))
    const binaryPath = join(loRuntimeRoot, process.platform === 'win32' ? 'lo.cmd' : 'lo')
    const bootstrapEntry = join(loRuntimeRoot, 'entry.mjs')

    await writeFile(
      binaryPath,
      process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
      'utf8',
    )
    await chmod(binaryPath, 0o755)
    await writeFile(bootstrapEntry, 'export async function main() {}\n', 'utf8')

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
      lo: {
        binaryPath,
        bootstrapEntry,
      },
    })

    expect(runner.supportedRuntimes).toEqual(['node', 'lo'])
  })

  test('installs requested packages and reports installed versions', async () => {
    const execution = await createPreparedExecution({
      packages: [
        {
          id: 'sbp_pkg1',
          installScriptsAllowed: false,
          name: 'left-pad',
          registryHost: 'registry.npmjs.org',
          requestedVersion: '1.3.0',
        },
      ],
      requestJson: {
        network: {
          allowedHosts: ['registry.npmjs.org'],
          mode: 'allow_list',
        },
        packages: [
          {
            name: 'left-pad',
            version: '1.3.0',
          },
        ],
        runtime: 'node',
        source: {
          filename: 'task.mjs',
          kind: 'inline_script',
          script: 'console.log("sandbox script")',
        },
        task: 'Install and run',
        vaultAccess: 'read_only',
      },
    })
    const expectedNpmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

    spawnMock.mockImplementation(
      (command: string, args: string[], options: { cwd: string; env: Record<string, string> }) => {
        const child = new MockChildProcess()

        queueMicrotask(() => {
          void (async () => {
            if (command === expectedNpmCommand) {
              await mkdir(join(options.cwd, 'node_modules', 'left-pad'), { recursive: true })
              await writeFile(
                join(options.cwd, 'node_modules', 'left-pad', 'package.json'),
                JSON.stringify({ name: 'left-pad', version: '1.3.0' }),
                'utf8',
              )
              child.stdout.write('npm install ok')
              child.stdout.end()
              child.stderr.end()
              child.emit('close', 0, null)
              return
            }

            if (command === process.execPath) {
              child.stdout.write('script ok')
              child.stdout.end()
              child.stderr.end()
              child.emit('close', 0, null)
              return
            }

            child.emit('error', new Error(`unexpected command ${command}`))
          })()
        })

        return child as never
      },
    )

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })
    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected sandbox runner to succeed')
    }

    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[0]?.[0]).toBe(expectedNpmCommand)
    expect(spawnMock.mock.calls[0]?.[1]).toContain('left-pad@1.3.0')
    expect(spawnMock.mock.calls[0]?.[2]?.env?.npm_config_registry).toBe(
      'https://registry.npmjs.org/',
    )
    expect(spawnMock.mock.calls[1]?.[1]).toContain('--allow-addons')
    expect(result.value.status).toBe('completed')
    expect(result.value.packages).toEqual([
      {
        errorText: null,
        id: 'sbp_pkg1',
        name: 'left-pad',
        requestedVersion: '1.3.0',
        resolvedVersion: '1.3.0',
        status: 'installed',
      },
    ])
    expect(result.value.stderrText).toContain('network policy is not enforced')
  })

  test('blocks packages that require install scripts in local_dev mode', async () => {
    const execution = await createPreparedExecution({
      packages: [
        {
          id: 'sbp_pkg2',
          installScriptsAllowed: true,
          name: 'sharp',
          registryHost: 'registry.npmjs.org',
          requestedVersion: '0.33.5',
        },
      ],
      requestJson: {
        network: {
          allowedHosts: ['registry.npmjs.org'],
          mode: 'allow_list',
        },
        packages: [
          {
            name: 'sharp',
            version: '0.33.5',
          },
        ],
        runtime: 'node',
        source: {
          filename: 'task.mjs',
          kind: 'inline_script',
          script: 'console.log("sandbox script")',
        },
        task: 'Reject install scripts',
        vaultAccess: 'read_only',
      },
    })
    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })

    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected sandbox runner to return a terminal result')
    }

    expect(spawnMock).not.toHaveBeenCalled()
    expect(result.value.status).toBe('failed')
    expect(result.value.errorText).toContain(
      'does not support packages that need install scripts, postinstall setup, or native binaries',
    )
    expect(result.value.errorText).toContain('Prefer pure-JS packages or a managed sandbox runner')
    expect(result.value.failure).toMatchObject({
      hint: expect.stringContaining('--ignore-scripts'),
      phase: 'package_install',
      runner: 'local_dev',
    })
    expect(result.value.packages).toEqual([
      {
        errorText:
          'local dev sandbox runner does not support packages that need install scripts, postinstall setup, or native binaries',
        id: 'sbp_pkg2',
        name: 'sharp',
        requestedVersion: '0.33.5',
        resolvedVersion: null,
        status: 'blocked',
      },
    ])
  })

  test('classifies script execution failures and preserves stderr previews', async () => {
    const execution = await createPreparedExecution()

    spawnMock.mockImplementation((command: string) => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        if (command === process.execPath) {
          child.stderr.write(
            'Error: Cannot find module sharp\nENOENT: no such file or directory, open /input/source.jpg\n',
          )
          child.stdout.write('partial stdout')
          child.stdout.end()
          child.stderr.end()
          child.emit('close', 1, null)
        }
      })

      return child as never
    })

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })
    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected sandbox runner to return a terminal result')
    }

    expect(result.value.status).toBe('failed')
    expect(result.value.errorText).toContain('Sandbox script execution failed with exit code 1')
    expect(result.value.failure).toMatchObject({
      exitCode: 1,
      phase: 'script_execution',
      runner: 'local_dev',
      stderrPreview: expect.stringContaining('Cannot find module sharp'),
      stdoutPreview: 'partial stdout',
    })
    expect(result.value.failure?.hint).toContain('could not be loaded')
  })

  test('adds native package guidance for permission-model failures during script execution', async () => {
    const execution = await createPreparedExecution({
      packages: [
        {
          id: 'sbp_pkg_native',
          installScriptsAllowed: false,
          name: 'sharp',
          registryHost: 'registry.npmjs.org',
          requestedVersion: '0.33.5',
        },
      ],
      requestJson: {
        network: {
          allowedHosts: ['registry.npmjs.org'],
          mode: 'allow_list',
        },
        packages: [
          {
            name: 'sharp',
            version: '0.33.5',
          },
        ],
        runtime: 'node',
        source: {
          filename: 'task.mjs',
          kind: 'inline_script',
          script: 'console.log("sandbox script")',
        },
        task: 'Runtime native package failure',
        vaultAccess: 'read_only',
      },
    })

    const expectedNpmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

    spawnMock.mockImplementation((command: string, _args: string[], options: { cwd: string }) => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          if (command === expectedNpmCommand) {
            await mkdir(join(options.cwd, 'node_modules', 'sharp'), { recursive: true })
            await writeFile(
              join(options.cwd, 'node_modules', 'sharp', 'package.json'),
              JSON.stringify({ name: 'sharp', version: '0.33.5' }),
              'utf8',
            )
            child.stdout.end()
            child.stderr.end()
            child.emit('close', 0, null)
            return
          }

          if (command === process.execPath) {
            child.stderr.write(
              'Error [ERR_ACCESS_DENIED]: Access to this API has been restricted\n',
            )
            child.stdout.end()
            child.stderr.end()
            child.emit('close', 1, null)
          }
        })()
      })

      return child as never
    })

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })
    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected sandbox runner to return a terminal result')
    }

    expect(result.value.status).toBe('failed')
    expect(result.value.failure?.hint).toContain('native addons or install-time setup')
    expect(result.value.failure?.hint).toContain('managed sandbox runner')
  })

  test('explains require() failures for inline ESM scripts', async () => {
    const execution = await createPreparedExecution({
      requestJson: {
        runtime: 'node',
        source: {
          filename: 'task.mjs',
          kind: 'inline_script',
          script: 'const sharp = require("sharp")',
        },
        task: 'ESM require failure',
        vaultAccess: 'read_only',
      },
    })

    spawnMock.mockImplementation((command: string) => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        if (command === process.execPath) {
          child.stderr.write(
            'ReferenceError: require is not defined in ES module scope, you can use import instead\n',
          )
          child.stdout.end()
          child.stderr.end()
          child.emit('close', 1, null)
        }
      })

      return child as never
    })

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })
    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected sandbox runner to return a terminal result')
    }

    expect(result.value.status).toBe('failed')
    expect(result.value.errorText).toContain('Sandbox script execution failed with exit code 1')
    expect(result.value.failure?.hint).toContain('await import(...)')
    expect(result.value.failure?.hint).toContain('`.cjs` filename')
  })

  test('explains top-level return failures for inline ESM scripts', async () => {
    const execution = await createPreparedExecution({
      requestJson: {
        runtime: 'node',
        source: {
          filename: 'task.mjs',
          kind: 'inline_script',
          script: 'return { ok: true }',
        },
        task: 'ESM top-level return failure',
        vaultAccess: 'read_only',
      },
    })

    spawnMock.mockImplementation((command: string) => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        if (command === process.execPath) {
          child.stderr.write('SyntaxError: Illegal return statement\n')
          child.stdout.end()
          child.stderr.end()
          child.emit('close', 1, null)
        }
      })

      return child as never
    })

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })
    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected sandbox runner to return a terminal result')
    }

    expect(result.value.status).toBe('failed')
    expect(result.value.errorText).toContain('Sandbox script execution failed with exit code 1')
    expect(result.value.failure?.hint).toContain('Do not use top-level `return`')
    expect(result.value.failure?.hint).toContain('console.log(JSON.stringify(result))')
    expect(result.value.failure?.hint).not.toContain('export async function main')
  })

  test('explains wrapped script-body import failures with a specific hint', async () => {
    const execution = await createPreparedExecution({
      requestJson: {
        runtime: 'node',
        source: {
          filename: 'execute-mcp-code.mjs',
          kind: 'inline_script',
          script: 'import sharp from "sharp"\nreturn 1',
        },
        task: 'Wrapped script import failure',
        vaultAccess: 'read_only',
      },
    })

    spawnMock.mockImplementation((command: string) => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        if (command === process.execPath) {
          child.stderr.write('file:///tmp/execute-mcp-code.mjs:82\n')
          child.stderr.write('    import sharp from "sharp";\n')
          child.stderr.write('           ^^^^^\n\n')
          child.stderr.write("SyntaxError: Unexpected identifier 'sharp'\n")
          child.stdout.end()
          child.stderr.end()
          child.emit('close', 1, null)
        }
      })

      return child as never
    })

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })
    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected sandbox runner to return a terminal result')
    }

    expect(result.value.status).toBe('failed')
    expect(result.value.failure?.code).toBe('SANDBOX_VALIDATION_IMPORT_EXPORT_IN_SCRIPT_BODY')
    expect(result.value.failure?.hint).toContain('await import(...)')
    expect(result.value.failure?.hint).toContain('script body')
  })

  test('ignores reserved sandbox env keys before spawning child processes', async () => {
    const execution = await createPreparedExecution({
      requestJson: {
        env: {
          FOO: 'bar',
          NODE_OPTIONS: '--allow-fs-read=/',
          PATH: '/tmp/fake-bin',
          SANDBOX_HOST_ROOT: '/tmp/override',
        },
        runtime: 'node',
        source: {
          filename: 'task.mjs',
          kind: 'inline_script',
          script: 'console.log("sandbox script")',
        },
        task: 'Filter reserved env keys',
        vaultAccess: 'read_only',
      },
    })

    spawnMock.mockImplementation((command: string) => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        if (command === process.execPath) {
          child.stdout.write('script ok')
          child.stdout.end()
          child.stderr.end()
          child.emit('close', 0, null)
        }
      })

      return child as never
    })

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })
    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected sandbox runner to succeed')
    }

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock.mock.calls[0]?.[2]?.env?.FOO).toBe('bar')
    expect(spawnMock.mock.calls[0]?.[2]?.env?.NODE_OPTIONS).toBeUndefined()
    expect(spawnMock.mock.calls[0]?.[2]?.env?.PATH).toBe(process.env.PATH ?? '')
    expect(spawnMock.mock.calls[0]?.[2]?.env?.SANDBOX_HOST_ROOT).toBe(execution.hostRootRef)
    expect(result.value.status).toBe('completed')
    expect(result.value.stderrText).toContain('ignored reserved sandbox env key NODE_OPTIONS')
  })

  test('makes built-in just-bash available without requesting packages', async () => {
    const execution = await createPreparedExecution()

    spawnMock.mockImplementation(
      (command: string, args: string[], options: { cwd: string; env: Record<string, string> }) => {
        const child = new MockChildProcess()

        queueMicrotask(() => {
          void (async () => {
            if (command !== process.execPath) {
              child.emit('error', new Error(`unexpected command ${command}`))
              return
            }

            const statResult = await lstat(join(options.cwd, 'node_modules', 'just-bash'))
            child.stdout.write(
              JSON.stringify({
                allowFsReadArgs: args.filter((arg) => arg.startsWith('--allow-fs-read=')),
                hasBuiltInPackageLink: statResult.isSymbolicLink(),
              }),
            )
            child.stdout.end()
            child.stderr.end()
            child.emit('close', 0, null)
          })()
        })

        return child as never
      },
    )

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })
    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected sandbox runner to succeed')
    }

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(result.value.status).toBe('completed')
    expect(result.value.stdoutText).toContain('"hasBuiltInPackageLink":true')
    expect(result.value.stdoutText).toContain('--allow-fs-read=')
  })

  test('fails when inline script filename escapes the sandbox work directory', async () => {
    const execution = await createPreparedExecution({
      requestJson: {
        runtime: 'node',
        source: {
          filename: '../../../../escape.mjs',
          kind: 'inline_script',
          script: 'console.log("sandbox script")',
        },
        task: 'Reject unsafe inline filename',
        vaultAccess: 'read_only',
      },
    })
    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })

    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected sandbox runner to return a terminal result')
    }

    expect(spawnMock).not.toHaveBeenCalled()
    expect(result.value.status).toBe('failed')
    expect(result.value.errorText).toContain('escapes the sandbox work directory')
  })

  test('dispatches sandbox MCP bridge calls over child-process IPC', async () => {
    const mcpDispatcher = vi.fn(async () => ({
      ok: true as const,
      value: { id: 'ISSUE-1', title: 'Bridge ok' },
    }))
    const execution = await createPreparedExecution({
      mcpDispatcher,
    })

    spawnMock.mockImplementation((command: string) => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        if (command === process.execPath) {
          child.emit('message', {
            args: { id: 'ISSUE-1' },
            id: 'mcp_1',
            runtimeName: 'linear__get_issue',
            type: 'wonderlands_mcp_call',
          })
          setTimeout(() => {
            child.stdout.end()
            child.stderr.end()
            child.emit('close', 0, null)
          }, 0)
          return
        }

        child.emit('error', new Error(`unexpected command ${command}`))
      })

      return child as never
    })

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
    })
    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    expect(mcpDispatcher).toHaveBeenCalledWith({
      args: { id: 'ISSUE-1' },
      runtimeName: 'linear__get_issue',
    })
    const nodeChild = spawnMock.mock.results[0]?.value as MockChildProcess | undefined
    expect(nodeChild?.send).toHaveBeenCalledWith({
      id: 'mcp_1',
      ok: true,
      result: { id: 'ISSUE-1', title: 'Bridge ok' },
      type: 'wonderlands_mcp_response',
    })
  })

  test('dispatches sandbox MCP bridge calls through the real lo runtime when available', async () => {
    const loBinaryPath =
      process.env.SANDBOX_LO_BINARY ??
      join(homedir(), '.lo', 'bin', process.platform === 'win32' ? 'lo.cmd' : 'lo')
    const bootstrapEntry = resolve(
      process.cwd(),
      '../../packages/sandbox-runtime-lo/dist/entry.mjs',
    )

    if (!existsSync(loBinaryPath) || !existsSync(bootstrapEntry)) {
      return
    }

    const { spawn: realSpawn } =
      await vi.importActual<typeof import('node:child_process')>('node:child_process')

    spawnMock.mockImplementation(((
      command: string,
      args: string[],
      options: Parameters<typeof realSpawn>[2],
    ) => realSpawn(command, args, options)) as typeof spawnMock)

    const mcpDispatcher = vi.fn(async () => ({
      ok: true as const,
      value: {
        structuredContent: { id: 'ISSUE-1', title: 'Bridge ok' },
      },
    }))

    const execution = await createPreparedExecution({
      mcpDispatcher,
      policySnapshotJson: {
        enabled: true,
        network: {
          mode: 'off',
        },
        packages: {
          allowedRegistries: [],
          mode: 'allow_list',
        },
        runtime: {
          allowAutomaticCompatFallback: false,
          allowWorkspaceScripts: true,
          allowedEngines: ['lo'],
          defaultEngine: 'lo',
          maxDurationSec: 10,
          maxInputBytes: 1_000_000,
          maxMemoryMb: 128,
          maxOutputBytes: 1_000_000,
          nodeVersion: '22',
        },
        vault: {
          mode: 'read_only',
        },
      },
      requestJson: {
        network: {
          mode: 'off',
        },
        runtime: 'lo',
        source: {
          filename: 'execute-code.mjs',
          kind: 'inline_script',
          script: renderMcpCodeModeWrapperScript({
            catalog: {
              servers: [
                {
                  executableToolCount: 1,
                  namespace: 'linear',
                  serverId: 'srv_linear',
                  serverLabel: 'Linear',
                  toolCount: 1,
                  tools: [
                    {
                      binding: 'linear.get_issue',
                      description: 'Read a Linear issue.',
                      executable: true,
                      inputSchema: {},
                      member: 'get_issue',
                      namespace: 'linear',
                      outputSchema: null,
                      remoteName: 'get_issue',
                      runtimeName: 'linear__get_issue',
                      serverId: 'srv_linear',
                      serverLabel: 'Linear',
                      title: 'Get Issue',
                    },
                  ],
                },
              ],
              tools: [
                {
                  binding: 'linear.get_issue',
                  description: 'Read a Linear issue.',
                  executable: true,
                  inputSchema: {},
                  member: 'get_issue',
                  namespace: 'linear',
                  outputSchema: null,
                  remoteName: 'get_issue',
                  runtimeName: 'linear__get_issue',
                  serverId: 'srv_linear',
                  serverLabel: 'Linear',
                  title: 'Get Issue',
                },
              ],
            },
            code: 'console.log(JSON.stringify(await linear.get_issue({ id: "ISSUE-1" })));',
          }),
        },
        task: 'lo MCP bridge smoke test',
        vaultAccess: 'read_only',
      },
      runtime: 'lo',
    })

    const runner = createLocalDevSandboxRunner({
      logger: createLogger('error'),
      lo: {
        binaryPath: loBinaryPath,
        bootstrapEntry,
      },
    })
    const result = await runner.runExecution(execution)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected lo sandbox runner to return a terminal result')
    }

    expect(result.value.status).toBe('completed')
    expect(result.value.runtime).toBe('lo')
    expect(result.value.stderrText).toBeNull()
    expect(result.value.stdoutText?.trim()).toBe(
      JSON.stringify({ id: 'ISSUE-1', title: 'Bridge ok' }),
    )
    expect(mcpDispatcher).toHaveBeenCalledWith({
      args: { id: 'ISSUE-1' },
      runtimeName: 'linear__get_issue',
    })
  })
})
