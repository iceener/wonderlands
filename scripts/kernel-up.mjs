import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const pinnedKernelImagesRevision = '18e75774f6d5b5e646213264409c62b604d71391'
const defaultKernelSourceRepo = 'https://github.com/kernel/kernel-images'
const defaultKernelImage = `wonderlands/kernel-local:${pinnedKernelImagesRevision}`

const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker'
const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar'
const kernelDockerfilePath = 'images/chromium-headful/Dockerfile'
const serverEnvPath = resolve(process.cwd(), 'apps', 'server', '.env')

const fileExists = async (path) => {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

const ensureDirectory = async (path) => {
  await mkdir(path, { recursive: true })
}

const readServerKernelEnabled = async () => {
  if (!(await fileExists(serverEnvPath))) {
    return null
  }

  const source = await readFile(serverEnvPath, 'utf8')

  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const match = /^\s*KERNEL_ENABLED\s*=\s*(.*)\s*$/u.exec(line)

    if (!match) {
      continue
    }

    const rawValue = match[1]?.trim() ?? ''
    const normalized =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue

    return normalized.toLowerCase() === 'true'
  }

  return false
}

const runCommand = (command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
    })

    child.on('error', rejectPromise)
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
    })
  })

const commandSucceeds = async (command, args, options = {}) => {
  try {
    await runCommand(command, args, {
      ...options,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

const toTarballUrl = (repoUrl, revision) => {
  const normalized = repoUrl.replace(/\.git$/, '').replace(/\/+$/, '')

  if (normalized === 'https://github.com/kernel/kernel-images') {
    return `https://codeload.github.com/kernel/kernel-images/tar.gz/${revision}`
  }

  const match = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/)

  if (!match) {
    throw new Error(
      `Unsupported KERNEL_SOURCE_REPO "${repoUrl}". Only GitHub https remotes are supported.`,
    )
  }

  const [, owner, repo] = match
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${revision}`
}

const downloadKernelSource = async ({ archivePath, repoUrl, revision, sourceDir }) => {
  const tarballUrl = toTarballUrl(repoUrl, revision)
  const tempArchivePath = `${archivePath}.partial`
  const tempSourceDir = `${sourceDir}.partial`

  console.log(`Downloading Kernel source ${revision} from ${tarballUrl}`)
  const response = await fetch(tarballUrl)

  if (!response.ok) {
    throw new Error(`Failed to download Kernel source: HTTP ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  await ensureDirectory(dirname(archivePath))
  await writeFile(tempArchivePath, new Uint8Array(arrayBuffer))
  await rm(archivePath, { force: true })
  await rename(tempArchivePath, archivePath)
  await rm(tempSourceDir, { force: true, recursive: true })
  await ensureDirectory(tempSourceDir)
  await runCommand(tarCommand, ['-xzf', archivePath, '-C', tempSourceDir, '--strip-components=1'])
  await rm(sourceDir, { force: true, recursive: true })
  await ensureDirectory(dirname(sourceDir))
  await rename(tempSourceDir, sourceDir)
}

const ensureKernelSource = async ({ cacheRoot, repoUrl, revision, sourceDir }) => {
  if (await fileExists(sourceDir)) {
    return sourceDir
  }

  const archivePath = join(cacheRoot, `${revision}.tar.gz`)

  if (!(await fileExists(archivePath))) {
    await downloadKernelSource({
      archivePath,
      repoUrl,
      revision,
      sourceDir,
    })
    return sourceDir
  }

  const tempSourceDir = `${sourceDir}.partial`
  await rm(tempSourceDir, { force: true, recursive: true })
  await ensureDirectory(tempSourceDir)
  await runCommand(tarCommand, ['-xzf', archivePath, '-C', tempSourceDir, '--strip-components=1'])
  await rm(sourceDir, { force: true, recursive: true })
  await ensureDirectory(dirname(sourceDir))
  await rename(tempSourceDir, sourceDir)

  return sourceDir
}

const resolveKernelSourceDir = async () => {
  const overridePath = process.env.KERNEL_SOURCE_DIR?.trim()

  if (overridePath) {
    const resolved = resolve(process.cwd(), overridePath)
    const exists = await fileExists(resolved)

    if (!exists) {
      throw new Error(`KERNEL_SOURCE_DIR does not exist: ${resolved}`)
    }

    return resolved
  }

  const revision = process.env.KERNEL_IMAGES_REF?.trim() || pinnedKernelImagesRevision
  const repoUrl = process.env.KERNEL_SOURCE_REPO?.trim() || defaultKernelSourceRepo
  const cacheRoot = resolve(process.cwd(), '.cache', 'kernel-images')
  const sourceDir = join(cacheRoot, revision)

  await ensureDirectory(cacheRoot)
  await ensureKernelSource({
    cacheRoot,
    repoUrl,
    revision,
    sourceDir,
  })

  return sourceDir
}

const buildKernelImageIfNeeded = async ({ image, sourceDir }) => {
  const forceRebuild = process.env.KERNEL_REBUILD === 'true'
  const dockerfilePath = join(sourceDir, kernelDockerfilePath)

  if (!(await fileExists(dockerfilePath))) {
    throw new Error(`Kernel source does not contain ${kernelDockerfilePath}: ${sourceDir}`)
  }

  if (!forceRebuild) {
    const alreadyBuilt = await commandSucceeds(dockerCommand, ['image', 'inspect', image])

    if (alreadyBuilt) {
      console.log(`Kernel image already available: ${image}`)
      return
    }
  }

  console.log(`Building local Kernel image ${image}`)
  await runCommand(
    dockerCommand,
    ['build', '-f', kernelDockerfilePath, '-t', image, '.'],
    {
      cwd: sourceDir,
    },
  )
}

const startKernelCompose = async ({ image }) => {
  console.log(`Starting Kernel container with image ${image}`)
  await runCommand(dockerCommand, ['compose', '-f', 'docker-compose.kernel.yml', 'up', '-d'], {
    env: {
      ...process.env,
      KERNEL_IMAGE: image,
    },
  })
}

const main = async () => {
  const image = process.env.KERNEL_IMAGE?.trim() || defaultKernelImage
  const sourceDir = await resolveKernelSourceDir()
  const sourceStats = await stat(sourceDir)

  if (!sourceStats.isDirectory()) {
    throw new Error(`Kernel source path is not a directory: ${sourceDir}`)
  }

  await buildKernelImageIfNeeded({
    image,
    sourceDir,
  })
  await startKernelCompose({
    image,
  })

  console.log('Kernel is available on:')
  console.log('  CDP: http://127.0.0.1:9222')
  console.log('  Playwright API: http://127.0.0.1:10001')
  console.log('  Live view: http://127.0.0.1:8080')

  const serverKernelEnabled = await readServerKernelEnabled()

  if (serverKernelEnabled === false) {
    console.warn('')
    console.warn(`Server config is still disabling Kernel in ${serverEnvPath}.`)
    console.warn('Set KERNEL_ENABLED=true in apps/server/.env and restart the server process.')
  } else if (serverKernelEnabled === null) {
    console.warn('')
    console.warn(`Server env file not found at ${serverEnvPath}.`)
    console.warn('Create apps/server/.env, set KERNEL_ENABLED=true, and restart the server process.')
  } else {
    console.log('')
    console.log('If the server was already running, restart it now so it re-probes Kernel availability.')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
