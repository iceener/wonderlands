import type { PreparedSandboxExecution } from '../../../../domain/sandbox/sandbox-runner'
import type { SandboxExecutionRequest, SandboxPolicy } from '../../../../domain/sandbox/types'

export interface SandboxLoMcpBridgeManifest {
  pollIntervalMs: number
  requestsDirHostPath: string
  responsesDirHostPath: string
}

export interface SandboxLoExecutionManifest {
  args: string[]
  cwdHostPath: string
  env: Record<string, string>
  entryHostPath: string
  executionId: string
  hostRootRef: string
  inputRootRef: string
  mcpBridge?: SandboxLoMcpBridgeManifest
  outputRootRef: string
  policy: SandboxPolicy
  repoRootHostPath?: string
  request: SandboxExecutionRequest
  runtimeRootHostPath?: string
  runtime: 'lo'
  schemaVersion: '2026-04-07'
  workRootRef: string
}

export const buildSandboxLoExecutionManifest = (input: {
  cwdHostPath: string
  entryHostPath: string
  env: Record<string, string>
  execution: PreparedSandboxExecution
  mcpBridge?: SandboxLoMcpBridgeManifest
  policy: SandboxPolicy
  repoRootHostPath?: string
  request: SandboxExecutionRequest
  runtimeRootHostPath?: string
}): SandboxLoExecutionManifest => ({
  args: [...(input.request.args ?? [])],
  cwdHostPath: input.cwdHostPath,
  env: { ...input.env },
  entryHostPath: input.entryHostPath,
  executionId: input.execution.executionId,
  hostRootRef: input.execution.hostRootRef,
  inputRootRef: input.execution.inputRootRef,
  ...(input.mcpBridge ? { mcpBridge: input.mcpBridge } : {}),
  outputRootRef: input.execution.outputRootRef,
  policy: input.policy,
  ...(input.repoRootHostPath ? { repoRootHostPath: input.repoRootHostPath } : {}),
  request: input.request,
  ...(input.runtimeRootHostPath ? { runtimeRootHostPath: input.runtimeRootHostPath } : {}),
  runtime: 'lo',
  schemaVersion: '2026-04-07',
  workRootRef: input.execution.workRootRef,
})
