import { installSandboxGlobals } from './bootstrap/process-shim.mjs'
import { loadExecutionManifest } from './bootstrap/manifest.mjs'
import { runBashMode } from './bootstrap/bash-mode.mjs'
import { installMcpBridge } from './bootstrap/mcp-bridge.mjs'
import { runScriptMode } from './bootstrap/script-mode.mjs'

export async function main(manifestPath) {
  if (typeof manifestPath !== 'string' || manifestPath.trim().length === 0) {
    throw new Error('sandbox runtime bootstrap requires a manifest path argument')
  }

  const manifest = await loadExecutionManifest(manifestPath)
  installSandboxGlobals(manifest)
  installMcpBridge(manifest)

  if (
    manifest.request?.source?.kind !== 'inline_script' &&
    manifest.request?.source?.kind !== 'workspace_script'
  ) {
    throw new Error(`unsupported sandbox source kind ${String(manifest.request?.source?.kind)}`)
  }

  if (manifest.request?.mode === 'bash') {
    await runBashMode(manifest)
    return
  }

  await runScriptMode(manifest)
}

const runFromCli = async () => {
  if (globalThis.process?.versions?.node && process.argv[1]) {
    const { pathToFileURL } = await import('node:url')

    if (import.meta.url === pathToFileURL(process.argv[1]).href) {
      await main(process.argv[2])
    }
  }
}

await runFromCli()
