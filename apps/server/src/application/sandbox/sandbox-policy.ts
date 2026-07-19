// Barrel module: keeps the public sandbox policy API stable while the
// implementation is split across cohesive files:
//   - sandbox-policy-schemas.ts: zod schemas, inferred types, normalized shapes
//   - sandbox-policy-normalize.ts: shared low-level normalization primitives
//   - sandbox-policy-parsing.ts: SandboxPolicy JSON parsing
//   - sandbox-policy-validators.ts: execute/writeback argument validation

export { parseSandboxPolicyJson } from './sandbox-policy-parsing'
export type {
  CommitSandboxWritebackArgs,
  ExecuteArgs,
  NormalizedSandboxExecutionRequest,
  NormalizedSandboxRequestedPackage,
  NormalizedSandboxWritebackRequest,
  SandboxPolicyInput,
  ValidatedSandboxJobRequest,
} from './sandbox-policy-schemas'
export { sandboxPolicyInputSchema } from './sandbox-policy-schemas'

export {
  validateCommitSandboxWritebackArgs,
  validateExecuteArgs,
  validateRunSandboxJobArgs,
  validateSandboxExecutionRequest,
} from './sandbox-policy-validators'
