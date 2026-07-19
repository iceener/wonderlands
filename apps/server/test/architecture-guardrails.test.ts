import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

const collectTypescriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name)

      if (entry.isDirectory()) {
        return collectTypescriptFiles(entryPath)
      }

      return entry.name.endsWith('.ts') ? [entryPath] : []
    }),
  )

  return nested.flat()
}

describe('server architecture guardrails', () => {
  it('public conversation contracts derive from shared schema contracts', async () => {
    const file = resolve(testDir, '../../../packages/contracts/src/conversation.ts')
    const contents = await readFile(file, 'utf8')

    expect(contents).toContain("from './conversation-schemas'")
    expect(contents).not.toMatch(
      /export interface (?:AcceptedRunResumeOutput|AcceptedThreadInteractionOutput|BackendPendingWait|BackendSession|BackendThread|BackendThreadRootJob|CancelRunOutput|CompletedRunExecutionOutput|PostThreadMessageOutput|WaitingRunExecutionOutput)\b/,
    )
  })

  it('route modules do not redefine shared route helpers locally', async () => {
    const routesDir = resolve(testDir, '../src/adapters/http/routes/v1')
    const routeFiles = await collectTypescriptFiles(routesDir)
    const offenders: string[] = []

    for (const file of routeFiles) {
      const contents = await readFile(file, 'utf8')

      if (/(?:const|function)\s+toCommandContext\s*[=(]/m.test(contents)) {
        offenders.push(file)
      }

      if (/(?:const|function)\s+parseBody\s*[=(]/m.test(contents)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('command modules do not define file-local unwrap helpers', async () => {
    const commandsDir = resolve(testDir, '../src/application/commands')
    const commandFiles = await collectTypescriptFiles(commandsDir)
    const offenders: string[] = []

    for (const file of commandFiles) {
      const contents = await readFile(file, 'utf8')

      if (/(?:const|function)\s+unwrapOrThrow\s*[=(]/m.test(contents)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('idempotency response schemas re-export shared contracts', async () => {
    const file = resolve(testDir, '../src/adapters/http/idempotency-response-schemas.ts')
    const contents = await readFile(file, 'utf8')

    expect(contents).toContain("from '@wonderlands/contracts'")
    expect(contents).not.toMatch(
      /\bz\.(?:array|enum|intersection|literal|object|record|union)\s*\(/,
    )
  })

  it('all domain modules stay persistence-neutral and point inward', async () => {
    const domainDir = resolve(testDir, '../src/domain')
    const files = await collectTypescriptFiles(domainDir)
    const importPattern = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g
    const offenders: string[] = []

    for (const file of files) {
      const contents = await readFile(file, 'utf8')

      for (const match of contents.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2] ?? ''
        const forbiddenPath = /(?:^|\/)(?:app|application|adapters|db)(?:\/|$)/.test(specifier)
        const forbiddenPackage =
          specifier === 'drizzle-orm' ||
          specifier.startsWith('drizzle-orm/') ||
          specifier === '@modelcontextprotocol' ||
          specifier.startsWith('@modelcontextprotocol/')

        if (forbiddenPath || forbiddenPackage) {
          offenders.push(`${file} -> ${specifier}`)
        }
      }

      if (/\$(?:inferSelect|inferInsert)\b/.test(contents)) {
        offenders.push(`${file} -> schema inference type`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('application modules do not execute raw persistence queries', async () => {
    const applicationDir = resolve(testDir, '../src/application')
    const files = await collectTypescriptFiles(applicationDir)
    const offenders: string[] = []

    for (const file of files) {
      const contents = await readFile(file, 'utf8')

      if (/from\s+['"]drizzle-orm(?:\/[^'"]*)?['"]/.test(contents)) {
        offenders.push(`${file} -> drizzle-orm`)
      }

      if (/from\s+['"][^'"]*\/db\/schema(?:\/[^'"]*)?['"]/.test(contents)) {
        offenders.push(`${file} -> db/schema`)
      }

      if (/\$(?:inferSelect|inferInsert)\b/.test(contents)) {
        offenders.push(`${file} -> schema inference type`)
      }
    }

    expect(offenders).toEqual([])
  })
})
