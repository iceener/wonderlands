import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, test } from 'vitest'

const tempRoots: string[] = []
const runtimeImportFromPattern = /(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g
const runtimeImportBarePattern = /(import\s+['"])(\.{1,2}\/[^'"]+)(['"])/g
const runtimeImportCallPattern = /(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g

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

const stageLoRuntimeForTest = async (input: {
  bootstrapEntryPath: string
  runtimeRoot: string
}) => {
  const sourceRuntimeRoot = dirname(input.bootstrapEntryPath)
  await cp(sourceRuntimeRoot, input.runtimeRoot, {
    recursive: true,
  })

  const runtimeFiles = await collectRuntimeFiles(input.runtimeRoot)

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

  return join(input.runtimeRoot, 'entry.mjs')
}

test('sandbox-runtime-lo bootstrap runs bash mode through the real lo runtime when available', async () => {
  const loBinaryPath =
    process.env.SANDBOX_LO_BINARY ??
    join(homedir(), '.lo', 'bin', process.platform === 'win32' ? 'lo.cmd' : 'lo')
  const bootstrapEntryPath = resolve(
    process.cwd(),
    '../../packages/sandbox-runtime-lo/dist/entry.mjs',
  )

  if (!existsSync(loBinaryPath) || !existsSync(bootstrapEntryPath)) {
    return
  }

  const root = await mkdtemp(join(tmpdir(), 'wl-lo-bash-'))
  tempRoots.push(root)

  const workRoot = join(root, 'work')
  const inputRoot = join(root, 'input')
  const outputRoot = join(root, 'output')
  const runtimeRoot = join(workRoot, '.wonderlands', 'runtime-lo')
  const vaultRoot = join(root, 'vault', 'overment')
  const manifestPath = join(root, 'manifest.json')

  await mkdir(workRoot, { recursive: true })
  await mkdir(inputRoot, { recursive: true })
  await mkdir(outputRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })
  await writeFile(join(vaultRoot, 'nora.txt'), 'nora\n', 'utf8')
  const stagedBootstrapEntryPath = await stageLoRuntimeForTest({
    bootstrapEntryPath,
    runtimeRoot,
  })

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        args: [],
        cwdHostPath: workRoot,
        entryHostPath: join(workRoot, 'placeholder.js'),
        env: {},
        executionId: 'sbx_test_lo_bash',
        hostRootRef: root,
        inputRootRef: inputRoot,
        outputRootRef: outputRoot,
        policy: {
          enabled: true,
          network: { mode: 'off' },
          packages: { allowedRegistries: [], mode: 'allow_list' },
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
            allowedRoots: ['/vault'],
            mode: 'read_only',
          },
        },
        repoRootHostPath: resolve(dirname(bootstrapEntryPath), '../../..'),
        request: {
          mode: 'bash',
          network: { mode: 'off' },
          runtime: 'lo',
          source: {
            filename: 'task.sh',
            kind: 'inline_script',
            script: 'pwd\nls /vault/overment\ncat /vault/overment/nora.txt\n',
          },
          task: 'lo bash smoke test',
          vaultAccess: 'read_only',
        },
        runtime: 'lo',
        runtimeRootHostPath: runtimeRoot,
        schemaVersion: '2026-04-07',
        workRootRef: workRoot,
      },
      null,
      2,
    ),
    'utf8',
  )

  const result = await collectSpawnResult({
    args: [stagedBootstrapEntryPath, manifestPath],
    command: loBinaryPath,
    cwd: runtimeRoot,
  })

  assert.equal(result.code, 0)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout, '/work\nnora.txt\nnora\n')
})

test('sandbox-runtime-lo bash mode supports rg over /vault without ignore files present', async () => {
  const loBinaryPath =
    process.env.SANDBOX_LO_BINARY ??
    join(homedir(), '.lo', 'bin', process.platform === 'win32' ? 'lo.cmd' : 'lo')
  const bootstrapEntryPath = resolve(
    process.cwd(),
    '../../packages/sandbox-runtime-lo/dist/entry.mjs',
  )

  if (!existsSync(loBinaryPath) || !existsSync(bootstrapEntryPath)) {
    return
  }

  const root = await mkdtemp(join(tmpdir(), 'wl-lo-bash-rg-'))
  tempRoots.push(root)

  const workRoot = join(root, 'work')
  const inputRoot = join(root, 'input')
  const outputRoot = join(root, 'output')
  const runtimeRoot = join(workRoot, '.wonderlands', 'runtime-lo')
  const vaultRoot = join(root, 'vault', 'overment', 'music', 'deep-house')
  const manifestPath = join(root, 'manifest.json')

  await mkdir(workRoot, { recursive: true })
  await mkdir(inputRoot, { recursive: true })
  await mkdir(outputRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })
  await writeFile(join(vaultRoot, 'nora.md'), 'Nora En Pure\nPretoria\n', 'utf8')
  await writeFile(join(vaultRoot, 'notes.md'), 'adjacent artists\n', 'utf8')
  const stagedBootstrapEntryPath = await stageLoRuntimeForTest({
    bootstrapEntryPath,
    runtimeRoot,
  })

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        args: [],
        cwdHostPath: workRoot,
        entryHostPath: join(workRoot, 'placeholder.js'),
        env: {},
        executionId: 'sbx_test_lo_bash_rg',
        hostRootRef: root,
        inputRootRef: inputRoot,
        outputRootRef: outputRoot,
        policy: {
          enabled: true,
          network: { mode: 'off' },
          packages: { allowedRegistries: [], mode: 'allow_list' },
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
            allowedRoots: ['/vault'],
            mode: 'read_only',
          },
        },
        repoRootHostPath: resolve(dirname(bootstrapEntryPath), '../../..'),
        request: {
          mode: 'bash',
          network: { mode: 'off' },
          runtime: 'lo',
          source: {
            filename: 'task.sh',
            kind: 'inline_script',
            script: 'rg -n -i "nora" /vault || true\n',
          },
          task: 'lo bash rg smoke test',
          vaultAccess: 'read_only',
        },
        runtime: 'lo',
        runtimeRootHostPath: runtimeRoot,
        schemaVersion: '2026-04-07',
        workRootRef: workRoot,
      },
      null,
      2,
    ),
    'utf8',
  )

  const result = await collectSpawnResult({
    args: [stagedBootstrapEntryPath, manifestPath],
    command: loBinaryPath,
    cwd: runtimeRoot,
  })

  assert.equal(result.code, 0)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /\/vault\/overment\/music\/deep-house\/nora\.md:1:Nora En Pure/)
})
