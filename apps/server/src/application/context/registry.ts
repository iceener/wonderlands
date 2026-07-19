import type { ContextContribution, ContextContributor, ContextContributorInput } from './contracts'

const assertValidContributor = (
  contributor: ContextContributor,
  ids: Set<string>,
  orders: Set<number>,
): void => {
  if (contributor.id.trim().length === 0) {
    throw new Error('Context contributor id must not be empty')
  }

  if (!Number.isSafeInteger(contributor.order)) {
    throw new Error(
      `Context contributor "${contributor.id}" order must be a safe integer: ${contributor.order}`,
    )
  }

  if (ids.has(contributor.id)) {
    throw new Error(`Duplicate context contributor id: "${contributor.id}"`)
  }

  if (orders.has(contributor.order)) {
    throw new Error(`Duplicate context contributor order: ${contributor.order}`)
  }

  ids.add(contributor.id)
  orders.add(contributor.order)
}

/**
 * Defines an immutable, deterministically ordered registry from explicit imports.
 * There is intentionally no process-global register/unregister API.
 */
export const defineContextContributors = (
  contributors: readonly ContextContributor[],
): readonly ContextContributor[] => {
  const ids = new Set<string>()
  const orders = new Set<number>()

  for (const contributor of contributors) {
    assertValidContributor(contributor, ids, orders)
  }

  const ordered = contributors
    .map((contributor) => Object.freeze({ ...contributor }))
    .sort((left, right) => left.order - right.order)

  return Object.freeze(ordered)
}

/** Runs a supplied static registry without changing the input or contributor outputs. */
export const buildContextContributions = (
  contributors: readonly ContextContributor[],
  input: ContextContributorInput,
): readonly ContextContribution[] =>
  Object.freeze(contributors.flatMap((contributor) => contributor.build(input)))

// Cora will add explicit imports here as contributor modules land. An empty registry is a valid
// behavior-neutral foundation and cannot affect the legacy assembler before final wiring.
export const contextContributors = defineContextContributors([])
