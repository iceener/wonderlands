import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, test } from 'vitest'

const tempRoots: string[] = []
const _runtimeImportFromPattern = /(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g
const _runtimeImportBarePattern = /(import\s+['"])(\.{1,2}\/[^'"]+)(['"])/g
const _runtimeImportCallPattern = /(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await rm(root, {
        force: true,
        recursive: true,
      })
    }),
  )
})

const collectSpawnResult = async (input: {
  args: string[]
  command: string
  cwd: string
  env?: NodeJS.ProcessEnv
}) =>
  await new Promise<{
    code: number | null
    stderr: string
    stdout: string
  }>((resolvePromise) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', (code) => {
      resolvePromise({
        code,
        stderr,
        stdout,
      })
    })
  })

const _collectRuntimeFiles = async (sourceDir: string): Promise<string[]> => {
  const entries = await readdir(sourceDir, {
    withFileTypes: true,
  })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = join(sourceDir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await _collectRuntimeFiles(entryPath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(entryPath)
    }
  }

  return files
}
test('sandbox-runtime-lo bootstrap loads the manifest and runs script mode in Node', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wl-lo-bootstrap-'))
  tempRoots.push(root)

  const workRoot = join(root, 'work')
  const inputRoot = join(root, 'input')
  const outputRoot = join(root, 'output')
  const scriptPath = join(workRoot, 'task.mjs')
  const manifestPath = join(root, 'manifest.json')
  const bootstrapEntryPath = resolve(
    process.cwd(),
    '../../packages/sandbox-runtime-lo/src/entry.mjs',
  )

  await mkdir(workRoot, {
    recursive: true,
  })
  await mkdir(inputRoot, {
    recursive: true,
  })
  await mkdir(outputRoot, {
    recursive: true,
  })

  await writeFile(
    scriptPath,
    [
      'console.log(JSON.stringify({',
      '  customFlag: process.env.CUSTOM_FLAG,',
      '  executionId: process.env.SANDBOX_EXECUTION_ID,',
      '  topLevel: true',
      '}));',
      'export async function main(...args) {',
      '  console.log(JSON.stringify({',
      '    args,',
      '    cwd: process.cwd(),',
      '    inputDir: process.env.SANDBOX_INPUT_DIR,',
      '    mode: "main"',
      '  }));',
      '}',
    ].join('\n'),
    'utf8',
  )

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        args: ['alpha', 'beta'],
        cwdHostPath: workRoot,
        entryHostPath: scriptPath,
        env: {
          CUSTOM_FLAG: 'yes',
        },
        executionId: 'sbx_test_lo_bootstrap',
        hostRootRef: root,
        inputRootRef: inputRoot,
        outputRootRef: outputRoot,
        request: {
          source: {
            filename: 'task.mjs',
            kind: 'inline_script',
            script: 'console.log("ignored because entryHostPath is used")',
          },
        },
        workRootRef: workRoot,
      },
      null,
      2,
    ),
    'utf8',
  )

  const result = await collectSpawnResult({
    args: [bootstrapEntryPath, manifestPath],
    command: process.execPath,
    cwd: workRoot,
  })

  assert.equal(result.code, 0)
  assert.equal(result.stderr, '')

  const lines = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

  assert.deepEqual(lines[0], {
    customFlag: 'yes',
    executionId: 'sbx_test_lo_bootstrap',
    topLevel: true,
  })
  assert.deepEqual(lines[1]?.args, ['alpha', 'beta'])
  assert.equal(lines[1]?.mode, 'main')
  assert.equal(lines[1]?.inputDir, inputRoot)
  assert.match(String(lines[1]?.cwd), /wl-lo-bootstrap-.*\/work$/)
})

test('sandbox-runtime-lo bootstrap exposes the MCP bridge helper in script mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wl-lo-mcp-bridge-'))
  tempRoots.push(root)

  const workRoot = join(root, 'work')
  const inputRoot = join(root, 'input')
  const outputRoot = join(root, 'output')
  const bridgeRoot = join(workRoot, '.wonderlands', 'mcp-bridge')
  const requestsDir = join(bridgeRoot, 'requests')
  const responsesDir = join(bridgeRoot, 'responses')
  const scriptPath = join(workRoot, 'task.mjs')
  const manifestPath = join(root, 'manifest.json')
  const bootstrapEntryPath = resolve(
    process.cwd(),
    '../../packages/sandbox-runtime-lo/src/entry.mjs',
  )

  await mkdir(workRoot, { recursive: true })
  await mkdir(inputRoot, { recursive: true })
  await mkdir(outputRoot, { recursive: true })
  await mkdir(requestsDir, { recursive: true })
  await mkdir(responsesDir, { recursive: true })

  await writeFile(
    scriptPath,
    [
      'async function main() {',
      '  const result = await globalThis.__wonderlandsCallMcp("linear__get_issue", { id: "ISSUE-1" });',
      '  console.log(JSON.stringify(result));',
      '}',
      'main().catch((error) => {',
      '  console.error(error?.message ?? String(error));',
      '  process.exit(1);',
      '});',
    ].join('\n'),
    'utf8',
  )

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        args: [],
        cwdHostPath: workRoot,
        entryHostPath: scriptPath,
        env: {},
        executionId: 'sbx_test_lo_mcp_bridge',
        hostRootRef: root,
        inputRootRef: inputRoot,
        mcpBridge: {
          pollIntervalMs: 10,
          requestsDirHostPath: requestsDir,
          responsesDirHostPath: responsesDir,
        },
        outputRootRef: outputRoot,
        policy: {
          runtime: {
            maxDurationSec: 5,
          },
        },
        repoRootHostPath: resolve(dirname(bootstrapEntryPath), '../../..'),
        request: {
          source: {
            filename: 'task.mjs',
            kind: 'inline_script',
            script: 'ignored because entryHostPath is used',
          },
        },
        workRootRef: workRoot,
      },
      null,
      2,
    ),
    'utf8',
  )

  const child = spawn(process.execPath, [bootstrapEntryPath, manifestPath], {
    cwd: workRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })

  const responsePromise = (async () => {
    const deadlineAt = Date.now() + 2_000

    while (Date.now() <= deadlineAt) {
      const requestFiles = await readdir(requestsDir)
      const requestFile = requestFiles.find((name) => name.endsWith('.json'))

      if (requestFile) {
        const requestPath = join(requestsDir, requestFile)
        const request = JSON.parse(await readFile(requestPath, 'utf8')) as {
          args: Record<string, unknown>
          id: string
          runtimeName: string
          type: string
        }

        assert.equal(request.type, 'wonderlands_mcp_call')
        assert.equal(request.runtimeName, 'linear__get_issue')
        assert.deepEqual(request.args, {
          id: 'ISSUE-1',
        })

        const responsePath = join(responsesDir, `${request.id}.json`)
        const temporaryResponsePath = `${responsePath}.tmp`
        await writeFile(
          temporaryResponsePath,
          JSON.stringify({
            id: request.id,
            ok: true,
            result: {
              id: 'ISSUE-1',
              title: 'Bridge ok',
            },
            type: 'wonderlands_mcp_response',
          }),
          'utf8',
        )
        await rename(temporaryResponsePath, responsePath)
        return
      }

      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 10)
      })
    }

    throw new Error('timed out waiting for MCP bridge request')
  })()

  const result = await new Promise<{
    code: number | null
  }>((resolvePromise) => {
    child.on('close', (code) => {
      resolvePromise({ code })
    })
  })

  await responsePromise

  assert.equal(result.code, 0)
  assert.equal(stderr, '')
  assert.equal(stdout.trim(), JSON.stringify({ id: 'ISSUE-1', title: 'Bridge ok' }))
})
