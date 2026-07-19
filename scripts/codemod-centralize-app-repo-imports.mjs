#!/usr/bin/env node
// One-off codemod: within apps/server/src/application/** only, repoint
// value imports of `create*Repository` factories away from
// `adapters/persistence/sqlite/**` and toward the single centralized
// composition module `application/persistence/repositories.ts`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(__dirname, '..', 'apps', 'server')
const srcRoot = resolve(serverRoot, 'src')
const appRoot = resolve(srcRoot, 'application')
const centralModule = resolve(appRoot, 'persistence', 'repositories.ts')

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
}

const files = []
walk(appRoot, files)

function toRelativeImport(fromFile, toAbsNoExt) {
  const fromDir = dirname(fromFile)
  let rel = relative(fromDir, toAbsNoExt).split('\\').join('/')
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

const importStmtRe = /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+'([^']+)'/g

let changedFiles = 0

for (const file of files) {
  if (file === centralModule) continue

  let content = readFileSync(file, 'utf8')
  let changed = false

  content = content.replace(importStmtRe, (full, typeOnlyKeyword, specifierBlock, specifier) => {
    if (typeOnlyKeyword) return full
    if (!specifier.includes('adapters/persistence/sqlite')) return full

    const rawSpecifiers = specifierBlock
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

    const valueSpecifiers = rawSpecifiers.filter((entry) => !entry.startsWith('type '))
    const typeSpecifiers = rawSpecifiers
      .filter((entry) => entry.startsWith('type '))
      .map((entry) => entry.slice('type '.length).trim())

    const unknownValues = valueSpecifiers.filter((name) => !/^create[A-Za-z]+Repository$/.test(name))

    if (unknownValues.length > 0) {
      console.warn(`[skip] ${file}: unrecognized value import(s) [${unknownValues.join(', ')}] from ${specifier}`)
      return full
    }

    if (valueSpecifiers.length === 0) return full

    changed = true

    const statements = []

    if (typeSpecifiers.length > 0) {
      statements.push(`import type { ${typeSpecifiers.join(', ')} } from '${specifier}'`)
    }

    const newSpecifier = toRelativeImport(file, resolve(appRoot, 'persistence', 'repositories'))
    statements.push(`import { ${valueSpecifiers.join(', ')} } from '${newSpecifier}'`)

    return statements.join('\n')
  })

  if (changed) {
    writeFileSync(file, content)
    changedFiles += 1
    console.log(`[updated] ${relative(serverRoot, file)}`)
  }
}

console.log(`\nDone. ${changedFiles} file(s) updated.`)
