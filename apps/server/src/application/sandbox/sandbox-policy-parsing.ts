import type { SandboxPolicy, SandboxRuntime } from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import {
  defaultSandboxPolicy,
  normalizeHostList,
  normalizeList,
  normalizeRegistryHostList,
  normalizeVaultPath,
  toValidationResult,
} from './sandbox-policy-normalize'
import { sandboxPolicyInputSchema } from './sandbox-policy-schemas'

export const parseSandboxPolicyJson = (value: unknown): Result<SandboxPolicy, DomainError> => {
  if (value === undefined || value === null) {
    return ok(defaultSandboxPolicy())
  }

  const parsed = toValidationResult(sandboxPolicyInputSchema.safeParse(value))

  if (!parsed.ok) {
    return parsed
  }

  const base = defaultSandboxPolicy()
  const allowedRoots: string[] = []

  for (const root of parsed.value.vault?.allowedRoots ?? []) {
    const normalizedRoot = normalizeVaultPath(root, 'sandbox.vault.allowedRoots entry')

    if (!normalizedRoot.ok) {
      return normalizedRoot
    }

    allowedRoots.push(normalizedRoot.value)
  }

  const hasExplicitEnginePolicy =
    parsed.value.runtime?.defaultEngine !== undefined ||
    (parsed.value.runtime?.allowedEngines?.length ?? 0) > 0

  const allowedEngines = Array.from(
    new Set(
      parsed.value.runtime?.allowedEngines ??
        (hasExplicitEnginePolicy ? base.runtime.allowedEngines : (['node'] as SandboxRuntime[])),
    ),
  )

  const defaultEngine =
    parsed.value.runtime?.defaultEngine ??
    (hasExplicitEnginePolicy ? base.runtime.defaultEngine : 'node')

  if (!allowedEngines.includes(defaultEngine)) {
    return err({
      message: 'sandbox.runtime.defaultEngine must be included in sandbox.runtime.allowedEngines',
      type: 'validation',
    })
  }

  if (
    parsed.value.runtime?.allowAutomaticCompatFallback === true &&
    !allowedEngines.includes('node')
  ) {
    return err({
      message:
        'sandbox.runtime.allowAutomaticCompatFallback requires sandbox.runtime.allowedEngines to include node',
      type: 'validation',
    })
  }

  return ok({
    enabled: parsed.value.enabled ?? base.enabled,
    network: {
      allowedHosts: normalizeHostList(parsed.value.network?.allowedHosts),
      mode: parsed.value.network?.mode ?? base.network.mode,
    },
    packages: {
      allowedPackages:
        parsed.value.packages?.allowedPackages && parsed.value.packages.allowedPackages.length > 0
          ? parsed.value.packages.allowedPackages.map((entry) => ({
              allowInstallScripts: entry.allowInstallScripts ?? false,
              name: entry.name.trim(),
              ...(entry.runtimes?.length ? { runtimes: Array.from(new Set(entry.runtimes)) } : {}),
              versionRange: entry.versionRange.trim(),
            }))
          : undefined,
      allowedRegistries: normalizeRegistryHostList(parsed.value.packages?.allowedRegistries),
      mode: parsed.value.packages?.mode ?? base.packages.mode,
    },
    runtime: {
      allowAutomaticCompatFallback:
        parsed.value.runtime?.allowAutomaticCompatFallback ??
        base.runtime.allowAutomaticCompatFallback,
      allowedEngines,
      allowWorkspaceScripts:
        parsed.value.runtime?.allowWorkspaceScripts ?? base.runtime.allowWorkspaceScripts,
      defaultEngine,
      maxDurationSec: parsed.value.runtime?.maxDurationSec ?? base.runtime.maxDurationSec,
      maxInputBytes: parsed.value.runtime?.maxInputBytes ?? base.runtime.maxInputBytes,
      maxMemoryMb: parsed.value.runtime?.maxMemoryMb ?? base.runtime.maxMemoryMb,
      maxOutputBytes: parsed.value.runtime?.maxOutputBytes ?? base.runtime.maxOutputBytes,
      nodeVersion: parsed.value.runtime?.nodeVersion?.trim() || base.runtime.nodeVersion,
    },
    shell:
      parsed.value.shell?.allowedCommands && parsed.value.shell.allowedCommands.length > 0
        ? {
            allowedCommands: normalizeList(parsed.value.shell.allowedCommands),
          }
        : undefined,
    vault: {
      allowedRoots: allowedRoots.length > 0 ? Array.from(new Set(allowedRoots)) : undefined,
      mode: parsed.value.vault?.mode ?? base.vault.mode,
      requireApprovalForDelete:
        parsed.value.vault?.requireApprovalForDelete ?? base.vault.requireApprovalForDelete,
      requireApprovalForMove:
        parsed.value.vault?.requireApprovalForMove ?? base.vault.requireApprovalForMove,
      requireApprovalForWorkspaceScript:
        parsed.value.vault?.requireApprovalForWorkspaceScript ??
        base.vault.requireApprovalForWorkspaceScript,
      requireApprovalForWrite:
        parsed.value.vault?.requireApprovalForWrite ?? base.vault.requireApprovalForWrite,
    },
  })
}
