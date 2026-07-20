import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'

import { createLocalDevSandboxRunner } from '../../src/adapters/sandbox/local-dev/local-dev-sandbox-runner'
import { buildSandboxBashWrapperScript } from '../../src/application/sandbox/sandbox-bash-wrapper'
import type { PreparedSandboxExecution } from '../../src/domain/sandbox/sandbox-runner'
import { createLogger } from '../../src/shared/logger'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await rm(root, { force: true, recursive: true })
    }),
  )
})

const createPreparedExecution = async (): Promise<PreparedSandboxExecution> => {
  const sandboxTestRoot = join(process.cwd(), 'var')
  await mkdir(sandboxTestRoot, { recursive: true })
  const hostRootRef = await mkdtemp(join(sandboxTestRoot, 'wl-sandbox-paths-'))
  tempRoots.push(hostRootRef)

  const inputRootRef = join(hostRootRef, 'input')
  const outputRootRef = join(hostRootRef, 'output')
  const workRootRef = join(hostRootRef, 'work')
  const workspaceMountRef = join(hostRootRef, 'workspace', 'demo')

  await mkdir(inputRootRef, { recursive: true })
  await mkdir(outputRootRef, { recursive: true })
  await mkdir(workRootRef, { recursive: true })
  await mkdir(workspaceMountRef, { recursive: true })
  await writeFile(join(workspaceMountRef, 'input.txt'), 'mounted content', 'utf8')

  return {
    executionId: 'sbx_test_paths',
    hostRootRef,
    inputRootRef,
    outputRootRef,
    packages: [],
    policySnapshotJson: {
      enabled: true,
      network: {
        mode: 'off',
      },
      packages: {
        mode: 'disabled',
      },
      runtime: {
        allowWorkspaceScripts: true,
        maxDurationSec: 15,
        maxInputBytes: 1_000_000,
        maxMemoryMb: 128,
        maxOutputBytes: 1_000_000,
        nodeVersion: '22',
      },
      vault: {
        mode: 'read_write',
      },
    },
    requestJson: {
      runtime: 'node',
      source: {
        filename: 'paths.mjs',
        kind: 'inline_script',
        script: [
          "import fs from 'node:fs';",
          "const mounted = fs.readFileSync('/workspace/demo/input.txt', 'utf8');",
          "fs.writeFileSync('/tmp/result.txt', `copied:${mounted}`, 'utf8');",
          "console.log('ok');",
        ].join('\n'),
      },
      task: 'Verify absolute sandbox path remapping',
      vaultAccess: 'read_only',
      vaultInputs: [
        {
          mountPath: '/workspace/demo',
          vaultPath: '/vault/demo',
        },
      ],
    },
    runtime: 'node',
    workRootRef,
  }
}

test('local dev runner remaps arbitrary absolute sandbox paths into the staged sandbox root', async () => {
  const execution = await createPreparedExecution()
  const runner = createLocalDevSandboxRunner({
    logger: createLogger('error'),
  })

  const result = await runner.runExecution(execution)

  assert.equal(result.ok, true)

  if (!result.ok) {
    throw new Error('expected local dev sandbox runner to succeed')
  }

  assert.equal(result.value.status, 'completed')
  assert.equal(result.value.stdoutText?.trim(), 'ok')
  const output = await readFile(join(execution.hostRootRef, 'tmp', 'result.txt'), 'utf8')
  assert.equal(output, 'copied:mounted content')
})

test('local dev bash copies a read-only vault file across mounts into output', async () => {
  const execution = await createPreparedExecution()
  const sourceRoot = join(execution.hostRootRef, 'vault', 'wonderlands', 'public', 'me', 'diet')
  await mkdir(sourceRoot, { recursive: true })
  await writeFile(join(sourceRoot, 'breakfast.jpg'), 'breakfast image', 'utf8')

  execution.requestJson = {
    cwdVaultPath: '/vault/wonderlands',
    runtime: 'node',
    source: {
      filename: 'execute-bash.mjs',
      kind: 'inline_script',
      script: buildSandboxBashWrapperScript({
        cwd: '/vault/wonderlands',
        mountVault: true,
        network: { mode: 'off' },
        script: 'cp public/me/diet/breakfast.jpg /output/breakfast.jpg',
        vaultWritable: false,
      }),
    },
    task: 'Attach the latest breakfast image',
    vaultAccess: 'read_only',
  }

  const runner = createLocalDevSandboxRunner({
    logger: createLogger('error'),
  })
  const result = await runner.runExecution(execution)

  assert.equal(result.ok, true)

  if (!result.ok) {
    throw new Error('expected cross-mount bash copy to succeed')
  }

  assert.equal(result.value.status, 'completed')
  assert.equal(
    await readFile(join(execution.outputRootRef, 'breakfast.jpg'), 'utf8'),
    'breakfast image',
  )
})
