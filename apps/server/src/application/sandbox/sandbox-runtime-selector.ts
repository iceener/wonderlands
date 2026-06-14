import type {
  SandboxPolicy,
  SandboxRequestedPackage,
  SandboxRuntime,
} from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

export interface SandboxRuntimeSelectionInput {
  policy: SandboxPolicy
  requestedPackages?: SandboxRequestedPackage[]
  requestedRuntime?: SandboxRuntime
  supportedRuntimes?: SandboxRuntime[]
}

export interface SelectedSandboxRuntime {
  reason: 'compat_fallback' | 'default' | 'requested'
  runtime: SandboxRuntime
}

const findAllowedPackage = (policy: SandboxPolicy, requestedPackage: SandboxRequestedPackage) =>
  policy.packages.allowedPackages?.find(
    (entry) =>
      entry.name === requestedPackage.name && entry.versionRange === requestedPackage.version,
  )

const resolveCompatibleRuntimesForPackage = (
  policy: SandboxPolicy,
  requestedPackage: SandboxRequestedPackage,
): SandboxRuntime[] | null => {
  if (policy.packages.mode === 'open') {
    return ['node']
  }

  const allowedPackage = findAllowedPackage(policy, requestedPackage)

  if (!allowedPackage) {
    return null
  }

  return allowedPackage.runtimes?.length ? allowedPackage.runtimes : policy.runtime.allowedEngines
}

const getRuntimeCompatibilityFailure = (
  runtime: SandboxRuntime,
  input: SandboxRuntimeSelectionInput,
): string | null => {
  if (!input.policy.runtime.allowedEngines.includes(runtime)) {
    return `sandbox runtime ${runtime} is not allowed for this agent`
  }

  if (input.supportedRuntimes && !input.supportedRuntimes.includes(runtime)) {
    return `sandbox runtime ${runtime} is not supported by the configured sandbox provider`
  }

  const requestedPackages = input.requestedPackages ?? []

  if (requestedPackages.length === 0) {
    return null
  }

  if (runtime === 'lo') {
    return 'requested packages are not supported by the lo sandbox engine yet; use the Node compat runtime for package-backed jobs'
  }

  if (input.policy.packages.mode === 'open' && runtime !== 'node') {
    return 'open package mode requires the Node compat runtime because package compatibility is unknown'
  }

  for (const requestedPackage of requestedPackages) {
    const compatibleRuntimes = resolveCompatibleRuntimesForPackage(input.policy, requestedPackage)

    if (!compatibleRuntimes || !compatibleRuntimes.includes(runtime)) {
      return `package ${requestedPackage.name}@${requestedPackage.version} is not marked compatible with sandbox runtime ${runtime}`
    }
  }

  return null
}

export const selectSandboxRuntime = (
  input: SandboxRuntimeSelectionInput,
): Result<SelectedSandboxRuntime, DomainError> => {
  if (input.requestedRuntime) {
    const requestedFailure = getRuntimeCompatibilityFailure(input.requestedRuntime, input)

    if (requestedFailure) {
      return err({
        message: requestedFailure,
        type: requestedFailure.includes('not allowed') ? 'permission' : 'conflict',
      })
    }

    return ok({
      reason: 'requested',
      runtime: input.requestedRuntime,
    })
  }

  const defaultRuntime = input.policy.runtime.defaultEngine
  const defaultFailure = getRuntimeCompatibilityFailure(defaultRuntime, input)

  if (!defaultFailure) {
    return ok({
      reason: 'default',
      runtime: defaultRuntime,
    })
  }

  if (
    input.policy.runtime.allowAutomaticCompatFallback &&
    defaultRuntime !== 'node' &&
    input.policy.runtime.allowedEngines.includes('node')
  ) {
    const compatFailure = getRuntimeCompatibilityFailure('node', input)

    if (!compatFailure) {
      return ok({
        reason: 'compat_fallback',
        runtime: 'node',
      })
    }
  }

  return err({
    message: defaultFailure,
    type: defaultFailure.includes('not allowed') ? 'permission' : 'conflict',
  })
}
