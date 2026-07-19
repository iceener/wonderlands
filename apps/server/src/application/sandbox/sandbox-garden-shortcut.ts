import type { AppDatabase } from '../../db/client'
import type { DomainError } from '../../shared/errors'
import type { AgentRevisionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import { loadGardenAgentContext } from '../garden/garden-agent-context'
import type { ExecuteArgs } from './sandbox-policy'

const normalizeGardenSelector = (value: string): string => value.trim()

const resolveGardenVaultPath = (gardenRoot: string, value: string): string => {
  const trimmed = value.trim()

  if (trimmed.startsWith('/')) {
    return trimmed
  }

  if (trimmed.length === 0 || trimmed === '.') {
    return gardenRoot
  }

  const withoutCurrentDir = trimmed.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')

  return withoutCurrentDir.length > 0 ? `${gardenRoot}/${withoutCurrentDir}` : gardenRoot
}

const ensureGardenVaultInput = (
  existingVaultInputs: NonNullable<ExecuteArgs['vaultInputs']>,
  gardenRoot: string,
): NonNullable<ExecuteArgs['vaultInputs']> => {
  const alreadyMountsGarden = existingVaultInputs.some(
    (entry) =>
      entry.vaultPath.trim() === gardenRoot &&
      (entry.mountPath?.trim() ?? entry.vaultPath.trim()) === gardenRoot,
  )

  return alreadyMountsGarden
    ? existingVaultInputs
    : [
        ...existingVaultInputs,
        {
          mountPath: gardenRoot,
          vaultPath: gardenRoot,
        },
      ]
}

const resolveGardenSource = (
  gardenRoot: string,
  source: ExecuteArgs['source'],
): ExecuteArgs['source'] => {
  if (source.kind !== 'workspace_script' && source.kind !== 'workspace') {
    return source
  }

  return {
    ...source,
    vaultPath: resolveGardenVaultPath(gardenRoot, source.vaultPath),
  }
}

const resolveGardenOutputs = (
  gardenRoot: string,
  outputs: ExecuteArgs['outputs'],
): ExecuteArgs['outputs'] => {
  if (!outputs?.writeBack) {
    return outputs
  }

  return {
    ...outputs,
    writeBack: outputs.writeBack.map((writeback) => ({
      ...writeback,
      toVaultPath: resolveGardenVaultPath(gardenRoot, writeback.toVaultPath),
    })),
  }
}

export const resolveSandboxJobGardenShortcut = (
  db: AppDatabase,
  input: {
    agentRevisionId: AgentRevisionId
    args: ExecuteArgs
    tenantScope: Parameters<typeof loadGardenAgentContext>[1]
  },
): Result<ExecuteArgs, DomainError> => {
  const selector = normalizeGardenSelector(input.args.garden ?? '')

  if (selector.length === 0) {
    return ok(input.args)
  }

  const gardenContext = loadGardenAgentContext(db, input.tenantScope, input.agentRevisionId)

  if (!gardenContext.ok) {
    return gardenContext
  }

  const site = gardenContext.value.gardens.find(
    (candidate) => candidate.slug === selector || candidate.id === selector,
  )

  if (!site) {
    return err({
      message: `garden ${selector} was not found in the current account workspace`,
      type: 'not_found',
    })
  }

  const existingVaultInputs = [...(input.args.vaultInputs ?? [])]
  const vaultInputs = ensureGardenVaultInput(existingVaultInputs, site.sourceRoot)
  const source = resolveGardenSource(site.sourceRoot, input.args.source)
  const outputs = resolveGardenOutputs(site.sourceRoot, input.args.outputs)

  return ok({
    ...input.args,
    ...(input.args.cwdVaultPath ? {} : { cwdVaultPath: site.sourceRoot }),
    ...(outputs ? { outputs } : {}),
    source,
    vaultInputs,
  } satisfies ExecuteArgs)
}
