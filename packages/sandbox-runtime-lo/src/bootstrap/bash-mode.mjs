import { getInstalledSandboxManifest } from './process-shim.mjs'
import { installSandboxModuleLoader } from './module-loader.mjs'
import { resolvePath } from './path-utils.mjs'
import { SandboxHostFs } from '../just-bash/lo-fs.mjs'

const runtimeRootPlaceholder = '__WONDERLANDS_SANDBOX_RUNTIME_ROOT__'

const defaultCommandSet = [
  'cat',
  'cd',
  'cp',
  'echo',
  'env',
  'find',
  'grep',
  'head',
  'ls',
  'mkdir',
  'mv',
  'printf',
  'pwd',
  'rg',
  'rm',
  'sed',
  'tail',
  'wc',
]

const writeToFd = (fd, text) => {
  if (!text) {
    return
  }

  if (globalThis.process?.versions?.node) {
    const stream = fd === 2 ? process.stderr : process.stdout
    stream.write(text)
    return
  }

  globalThis.lo.core.write_string(fd === 2 ? globalThis.lo.core.STDERR : globalThis.lo.core.STDOUT, text)
}

const sandboxCwdFromManifest = (manifest) => {
  if (manifest.request?.cwdVaultPath) {
    return manifest.request.cwdVaultPath
  }

  if (manifest.request?.source?.kind === 'workspace_script') {
    const scriptPath = manifest.request.source.vaultPath
    const lastSlashIndex = scriptPath.lastIndexOf('/')
    return lastSlashIndex <= 0 ? '/' : scriptPath.slice(0, lastSlashIndex)
  }

  return '/work'
}

const resolveAllowedCommands = (manifest) =>
  manifest.policy?.shell?.allowedCommands?.length
    ? manifest.policy.shell.allowedCommands
    : defaultCommandSet

const resolveRuntimePaths = () => {
  const runtimeRoot =
    globalThis.__wonderlandsSandbox?.runtimeRoot ??
    globalThis.process?.env?.SANDBOX_LO_RUNTIME_ROOT ??
    runtimeRootPlaceholder
  const repoRoot =
    globalThis.__wonderlandsSandbox?.repoRoot ??
    globalThis.process?.env?.SANDBOX_LO_REPO_ROOT ??
    resolvePath(runtimeRoot, '../../..')

  return {
    repoRoot,
    runtimeRoot,
    vendorBrowserPath: resolvePath(runtimeRoot, 'vendor/just-bash/browser.js'),
  }
}

const loadShellSource = async (manifest, fs) => {
  if (manifest.request.source.kind === 'inline_script') {
    return manifest.request.source.script
  }

  return await fs.readFile(manifest.request.source.vaultPath, 'utf8')
}

export const runBashMode = async (manifest) => {
  const sandboxManifest = getInstalledSandboxManifest() ?? manifest
  const runtimePaths = resolveRuntimePaths()

  if (globalThis.lo?.core) {
    installSandboxModuleLoader(runtimePaths)
  }

  const shellModule = await import(runtimePaths.vendorBrowserPath)
  const fs = await SandboxHostFs.create({
    hostRoot: sandboxManifest.hostRootRef,
    readOnlyRoots: [
      '/input',
      '/packages',
      ...(sandboxManifest.request.vaultAccess === 'read_write' ? [] : ['/vault']),
    ],
  })
  const bash = new shellModule.Bash({
    commands: resolveAllowedCommands(sandboxManifest),
    cwd: sandboxCwdFromManifest(sandboxManifest),
    env: sandboxManifest.env ?? {},
    fs,
  })

  try {
    const result = await bash.exec(await loadShellSource(sandboxManifest, fs), {
      rawScript: true,
    })

    writeToFd(1, result.stdout)
    writeToFd(2, result.stderr)

    if ((result.exitCode ?? 0) !== 0) {
      globalThis.process.exit(result.exitCode ?? 1)
    }
  } catch (error) {
    const text = error instanceof Error ? error.stack ?? error.message : String(error)
    writeToFd(2, `${text}\n`)
    globalThis.process.exit(1)
  }
}
