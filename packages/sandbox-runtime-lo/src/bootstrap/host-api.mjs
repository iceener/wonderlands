import { getInstalledSandboxManifest } from './process-shim.mjs'

export const getSandboxContext = () => {
  const manifest = getInstalledSandboxManifest()

  if (!manifest) {
    throw new Error('sandbox context is not installed in this runtime')
  }

  return {
    cwd: manifest.cwdHostPath,
    entryPath: manifest.entryHostPath,
    executionId: manifest.executionId,
    paths: {
      hostRoot: manifest.hostRootRef,
      input: manifest.inputRootRef,
      output: manifest.outputRootRef,
      work: manifest.workRootRef,
    },
    request: manifest.request,
  }
}
