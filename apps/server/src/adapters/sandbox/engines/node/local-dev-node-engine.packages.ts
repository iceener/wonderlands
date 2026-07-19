import { lstat, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'

import type { PreparedSandboxExecution, SandboxRunPackageResult } from '../../../../domain/sandbox/sandbox-runner'

const require = createRequire(import.meta.url)

const builtInSandboxPackageNames = ['just-bash'] as const

const toNodeModulesPackageJsonPath = (cwdHostPath: string, packageName: string): string =>
  join(cwdHostPath, 'node_modules', ...packageName.split('/'), 'package.json')

const resolveBuiltInSandboxPackage = (
  packageName: string,
): {
  nodeModulesRoot: string
  packageRoot: string
} | null => {
  try {
    let current = dirname(require.resolve(packageName))

    while (true) {
      const parent = dirname(current)

      if (basename(current) === packageName && basename(parent) === 'node_modules') {
        return {
          nodeModulesRoot: parent,
          packageRoot: current,
        }
      }

      if (parent === current) {
        return null
      }

      current = parent
    }
  } catch {
    return null
  }
}

const ensurePackageManifest = async (cwdHostPath: string, executionId: string): Promise<void> => {
  const packageJsonPath = join(cwdHostPath, 'package.json')

  try {
    await stat(packageJsonPath)
  } catch {
    await writeFile(
      packageJsonPath,
      JSON.stringify(
        {
          name: `sandbox-${executionId}`,
          private: true,
        },
        null,
        2,
      ),
      'utf8',
    )
  }
}

const ensureBuiltInSandboxPackages = async (
  moduleResolutionRoot: string,
): Promise<{
  additionalReadRoots: string[]
}> => {
  const additionalReadRoots = new Set<string>()
  const nodeModulesDir = join(moduleResolutionRoot, 'node_modules')
  await mkdir(nodeModulesDir, { recursive: true })

  for (const packageName of builtInSandboxPackageNames) {
    const resolved = resolveBuiltInSandboxPackage(packageName)

    if (!resolved) {
      continue
    }

    additionalReadRoots.add(resolved.nodeModulesRoot)

    const linkPath = join(nodeModulesDir, ...packageName.split('/'))
    await mkdir(dirname(linkPath), { recursive: true })

    try {
      await lstat(linkPath)
      continue
    } catch {
      // create the symlink below
    }

    await symlink(resolved.packageRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  }

  return {
    additionalReadRoots: Array.from(additionalReadRoots),
  }
}

const readResolvedPackageVersion = async (
  cwdHostPath: string,
  packageName: string,
): Promise<string | null> => {
  try {
    const parsed = JSON.parse(
      await readFile(toNodeModulesPackageJsonPath(cwdHostPath, packageName), 'utf8'),
    ) as { version?: unknown }

    return typeof parsed.version === 'string' && parsed.version.trim().length > 0
      ? parsed.version.trim()
      : null
  } catch {
    return null
  }
}

const buildPackageResults = async (
  cwdHostPath: string,
  packages: PreparedSandboxExecution['packages'],
  options:
    | {
        errorText: string
        forceStatus: 'blocked' | 'failed'
      }
    | undefined,
): Promise<SandboxRunPackageResult[]> => {
  const results: SandboxRunPackageResult[] = []

  for (const requestedPackage of packages) {
    const resolvedVersion = await readResolvedPackageVersion(cwdHostPath, requestedPackage.name)
    const installed = resolvedVersion !== null

    results.push({
      errorText: installed ? null : (options?.errorText ?? null),
      id: requestedPackage.id,
      name: requestedPackage.name,
      requestedVersion: requestedPackage.requestedVersion,
      resolvedVersion,
      status: installed ? 'installed' : (options?.forceStatus ?? 'failed'),
    })
  }

  return results
}

export { buildPackageResults, ensureBuiltInSandboxPackages, ensurePackageManifest }
