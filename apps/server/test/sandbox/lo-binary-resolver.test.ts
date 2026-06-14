import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'

import { resolveSandboxLoRuntime } from '../../src/adapters/sandbox/engines/lo/lo-binary-resolver'

const tempRoots: string[] = []

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

test('resolveSandboxLoRuntime discovers the default dist entry when present', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wl-lo-resolver-'))
  tempRoots.push(root)

  const binaryPath = join(root, process.platform === 'win32' ? 'lo.cmd' : 'lo')
  const bootstrapEntryPath = join(root, 'packages', 'sandbox-runtime-lo', 'dist', 'entry.mjs')

  await mkdir(join(root, 'packages', 'sandbox-runtime-lo', 'dist'), {
    recursive: true,
  })
  await writeFile(
    binaryPath,
    process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
    'utf8',
  )
  await chmod(binaryPath, 0o755)
  await writeFile(bootstrapEntryPath, 'export async function main() {}\n', 'utf8')

  const resolved = resolveSandboxLoRuntime(
    {
      binaryPath,
      bootstrapEntry: null,
    },
    {
      cwd: root,
    },
  )

  assert.equal(resolved.available, true)
  assert.equal(resolved.binaryPath, binaryPath)
  assert.equal(resolved.bootstrapEntryPath, bootstrapEntryPath)
})

test('resolveSandboxLoRuntime reports missing bootstrap assets clearly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wl-lo-resolver-'))
  tempRoots.push(root)

  const binaryPath = join(root, process.platform === 'win32' ? 'lo.cmd' : 'lo')

  await writeFile(
    binaryPath,
    process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
    'utf8',
  )
  await chmod(binaryPath, 0o755)

  const resolved = resolveSandboxLoRuntime(
    {
      binaryPath,
      bootstrapEntry: null,
    },
    {
      cwd: root,
    },
  )

  assert.equal(resolved.available, false)
  assert.match(resolved.detail, /no lo bootstrap entry was found/i)
})
