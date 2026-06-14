export interface SandboxLoBootstrapPlan {
  mode: 'bash' | 'script'
  runtimeVersion: 'v1'
}

export const createSandboxLoBootstrapPlan = (
  mode: SandboxLoBootstrapPlan['mode'],
): SandboxLoBootstrapPlan => ({
  mode,
  runtimeVersion: 'v1',
})
