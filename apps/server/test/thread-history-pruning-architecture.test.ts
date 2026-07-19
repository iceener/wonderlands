import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

describe('thread history pruning stays persistence-neutral at the application layer', () => {
  it('the pruning command does not import drizzle/db/schema/concrete sqlite adapters', async () => {
    const file = resolve(
      testDir,
      '../src/application/commands/thread-history-pruning.ts',
    )
    const contents = await readFile(file, 'utf8')
    const importSpecifierPattern = /from\s+['"]([^'"]+)['"]/g
    const offenders: string[] = []

    for (const match of contents.matchAll(importSpecifierPattern)) {
      const specifier = match[1]
      const isBareDrizzleImport =
        specifier === 'drizzle-orm' || specifier.startsWith('drizzle-orm/')
      // `db/transaction` only exposes the opaque `AppTransaction` handle type
      // (no table/schema/query-builder access) and is the sanctioned way for
      // application code to pass a transaction through to a repository
      // factory, so it is intentionally excluded from the forbidden set.
      const touchesForbiddenLayer =
        specifier.includes('db/schema') || specifier.split('/').some((segment) => segment === 'adapters')

      if (isBareDrizzleImport || touchesForbiddenLayer) {
        offenders.push(specifier)
      }
    }

    expect(offenders).toEqual([])
    expect(contents).toContain('createThreadHistoryPruningRepository')
  })

  it('the domain pruning port stays persistence-neutral', async () => {
    const file = resolve(
      testDir,
      '../src/domain/sessions/thread-history-pruning-repository.ts',
    )
    const contents = await readFile(file, 'utf8')
    const importSpecifierPattern = /from\s+['"]([^'"]+)['"]/g
    const offenders: string[] = []

    for (const match of contents.matchAll(importSpecifierPattern)) {
      const specifier = match[1]
      const isBareDrizzleImport =
        specifier === 'drizzle-orm' || specifier.startsWith('drizzle-orm/')
      const touchesForbiddenLayer = specifier
        .split('/')
        .some(
          (segment) => segment === 'db' || segment === 'application' || segment === 'adapters',
        )

      if (isBareDrizzleImport || touchesForbiddenLayer) {
        offenders.push(specifier)
      }
    }

    expect(offenders).toEqual([])
  })
})
