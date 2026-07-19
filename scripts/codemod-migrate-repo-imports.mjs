#!/usr/bin/env node
// One-off codemod: repoints imports of repository factories that were moved
// from `domain/**` to `adapters/persistence/sqlite/**`, splitting mixed
// type+value import statements as needed. Also repoints `RepositoryDatabase`
// imports from the removed `domain/database-port` to `db/repository-database`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(__dirname, '..', 'apps', 'server')
const srcRoot = resolve(serverRoot, 'src')

// factory name -> new module path (relative to src/)
const factoryMap = {
  createContextSummaryRepository: 'adapters/persistence/sqlite/runtime/context-summary-repository',
  createItemRepository: 'adapters/persistence/sqlite/runtime/item-repository',
  createJobDependencyRepository: 'adapters/persistence/sqlite/runtime/job-dependency-repository',
  createJobRepository: 'adapters/persistence/sqlite/runtime/job-repository',
  createRunClaimRepository: 'adapters/persistence/sqlite/runtime/run-claim-repository',
  createRunDependencyRepository: 'adapters/persistence/sqlite/runtime/run-dependency-repository',
  createRunRepository: 'adapters/persistence/sqlite/runtime/run-repository',
  createToolExecutionRepository: 'adapters/persistence/sqlite/runtime/tool-execution-repository',
  createSandboxExecutionFileRepository:
    'adapters/persistence/sqlite/sandbox/sandbox-execution-file-repository',
  createSandboxExecutionRepository: 'adapters/persistence/sqlite/sandbox/sandbox-execution-repository',
  createSandboxExecutionPackageRepository:
    'adapters/persistence/sqlite/sandbox/sandbox-package-repository',
  createSandboxWritebackRepository: 'adapters/persistence/sqlite/sandbox/sandbox-writeback-repository',
  createEventOutboxRepository: 'adapters/persistence/sqlite/events/event-outbox-repository',
  createDomainEventRepository: 'adapters/persistence/sqlite/events/domain-event-repository',
  createEventPayloadSidecarRepository: 'adapters/persistence/sqlite/events/event-payload-sidecar-repository',
}

// old domain module suffix -> matches any relative prefix
const oldModuleNames = [
  'domain/runtime/context-summary-repository',
  'domain/runtime/item-repository',
  'domain/runtime/job-dependency-repository',
  'domain/runtime/job-repository',
  'domain/runtime/run-claim-repository',
  'domain/runtime/run-dependency-repository',
  'domain/runtime/run-repository',
  'domain/runtime/tool-execution-repository',
  'domain/sandbox/sandbox-execution-file-repository',
  'domain/sandbox/sandbox-execution-repository',
  'domain/sandbox/sandbox-package-repository',
  'domain/sandbox/sandbox-writeback-repository',
  'domain/events/event-outbox-repository',
  'domain/events/domain-event-repository',
  'domain/events/event-payload-sidecar-repository',
]

const dbPortModule = 'domain/database-port'

function walk(dir, out) {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      walk(full, out)
    } else if (entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
}

const files = []
walk(srcRoot, files)
walk(resolve(serverRoot, 'test'), files)

function toRelativeImport(fromFile, toModuleRelToSrc) {
  const fromDir = dirname(fromFile)
  const toAbs = resolve(srcRoot, toModuleRelToSrc)
  let rel = relative(fromDir, toAbs).split('\\').join('/')
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

// Matches a full import statement (single or multiline) ending in `from '...'`
const importStmtRe = /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+'([^']+)'/g

let totalFilesChanged = 0

for (const file of files) {
  let content = readFileSync(file, 'utf8')
  let changed = false

  content = content.replace(importStmtRe, (full, typeOnlyKeyword, specifierBlock, specifier) => {
    // Determine which known module this specifier targets, if any
    const matchedOldModule = oldModuleNames.find((name) => specifier.endsWith(name))
    const isDbPort = specifier.endsWith(dbPortModule)

    if (!matchedOldModule && !isDbPort) {
      return full
    }

    changed = true

    if (isDbPort) {
      // Whole statement just needs its source path repointed.
      const newSpecifier = toRelativeImport(file, 'db/repository-database')
      return `import ${typeOnlyKeyword ? 'type ' : ''}{${specifierBlock}} from '${newSpecifier}'`
    }

    // matchedOldModule case: may need to split value vs type specifiers.
    const rawSpecifiers = specifierBlock
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)

    if (typeOnlyKeyword) {
      // Entire statement is type-only; nothing to move, domain file still
      // exports all types.
      return full
    }

    const valueSpecifiers = []
    const typeSpecifiers = []

    for (const entry of rawSpecifiers) {
      if (entry.startsWith('type ')) {
        typeSpecifiers.push(entry.slice('type '.length).trim())
      } else {
        valueSpecifiers.push(entry)
      }
    }

    // Only factory names should be "value" specifiers we know how to move;
    // if there's an unexpected value specifier, bail out conservatively by
    // leaving the statement untouched (surfaces as a manual fix).
    const unknownValues = valueSpecifiers.filter((name) => !(name in factoryMap))

    if (unknownValues.length > 0) {
      console.warn(`[skip] ${file}: unrecognized value import(s) [${unknownValues.join(', ')}] from ${specifier}`)
      return full
    }

    const statements = []

    if (typeSpecifiers.length > 0) {
      statements.push(`import type { ${typeSpecifiers.join(', ')} } from '${specifier}'`)
    }

    // Group value specifiers by their target module (should normally be one target per old module)
    const byTarget = new Map()
    for (const name of valueSpecifiers) {
      const target = factoryMap[name]
      const list = byTarget.get(target) ?? []
      list.push(name)
      byTarget.set(target, list)
    }

    for (const [target, names] of byTarget) {
      const newSpecifier = toRelativeImport(file, target)
      statements.push(`import { ${names.join(', ')} } from '${newSpecifier}'`)
    }

    return statements.join('\n')
  })

  if (changed) {
    writeFileSync(file, content)
    totalFilesChanged += 1
    console.log(`[updated] ${relative(serverRoot, file)}`)
  }
}

console.log(`\nDone. ${totalFilesChanged} file(s) updated.`)
