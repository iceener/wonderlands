import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
const srcRoot = join(packageRoot, 'src')
const distRoot = join(packageRoot, 'dist')
const justBashBundleRoot = resolve(packageRoot, '..', '..', 'node_modules', 'just-bash', 'dist', 'bundle')
const runtimeRootPlaceholder = '__WONDERLANDS_SANDBOX_RUNTIME_ROOT__'

const copyRuntimeSources = async (sourceDir, targetDir) => {
  const entries = await readdir(sourceDir, {
    withFileTypes: true,
  })

  await mkdir(targetDir, {
    recursive: true,
  })

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)

    if (entry.isDirectory()) {
      await copyRuntimeSources(sourcePath, targetPath)
      continue
    }

    if (!entry.isFile() || !entry.name.endsWith('.mjs')) {
      continue
    }

    await mkdir(dirname(targetPath), {
      recursive: true,
    })
    await cp(sourcePath, targetPath)
  }
}

const collectRuntimeFiles = async (sourceDir) => {
  const entries = await readdir(sourceDir, {
    withFileTypes: true,
  })
  const files = []

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

const replaceRuntimeRootPlaceholder = async (rootDir) => {
  const files = await collectRuntimeFiles(rootDir)

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8')
    const rewritten = source.replaceAll(runtimeRootPlaceholder, distRoot)

    if (rewritten !== source) {
      await writeFile(filePath, rewritten, 'utf8')
    }
  }
}

await rm(distRoot, {
  force: true,
  recursive: true,
})

await copyRuntimeSources(srcRoot, distRoot)
await cp(justBashBundleRoot, join(distRoot, 'vendor', 'just-bash'), {
  recursive: true,
})
await replaceRuntimeRootPlaceholder(distRoot)

const entryPath = join(distRoot, 'entry.mjs')
const entryStat = await stat(entryPath)

if (!entryStat.isFile()) {
  throw new Error(`expected bootstrap entry at ${relative(packageRoot, entryPath)}`)
}

await writeFile(
  join(distRoot, 'build-info.json'),
  JSON.stringify(
    {
      entry: './entry.mjs',
      generatedAt: new Date().toISOString(),
      notes: [
        'script mode bootstrap is wired',
        'bash mode uses the bundled just-bash browser bundle',
        'package-backed jobs still require the Node compat engine',
      ],
    },
    null,
    2,
  ),
  'utf8',
)
