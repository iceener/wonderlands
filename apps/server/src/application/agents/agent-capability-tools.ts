import type { KernelPolicy } from '../../domain/kernel/types'
import type { SandboxPolicy } from '../../domain/sandbox/types'
import type { AgentMarkdownFrontmatter } from './agent-markdown'

const sandboxDerivedNativeTools = new Set([
  'commit_sandbox_writeback',
  'execute',
  'get_tools',
  'get_tool',
  'search_tools',
])

const kernelDerivedNativeTools = new Set(['browse'])

const capabilityDerivedNativeToolNames = new Set([
  ...sandboxDerivedNativeTools,
  ...kernelDerivedNativeTools,
])

const normalizeNativeTools = (tools: string[] | undefined): string[] | undefined => {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined
  }

  const normalized = Array.from(
    new Set(tools.map((tool) => tool.trim()).filter((tool) => tool.length > 0)),
  )

  return normalized.length > 0 ? normalized : undefined
}

const collectSandboxCapabilityTools = (policy: SandboxPolicy): string[] => {
  if (!policy.enabled) {
    return []
  }

  const tools = ['execute']

  if (policy.vault.mode === 'read_write') {
    tools.push('commit_sandbox_writeback')
  }

  return tools
}

const collectMcpCodeModeTools = (
  tools: AgentMarkdownFrontmatter['tools'] | undefined,
  policy: SandboxPolicy,
): string[] => {
  if (!policy.enabled || tools?.mcpMode !== 'code') {
    return []
  }

  return ['search_tools', 'get_tools']
}

const collectKernelCapabilityTools = (policy: KernelPolicy): string[] =>
  policy.enabled ? ['browse'] : []

export const buildEffectiveNativeTools = (
  tools: AgentMarkdownFrontmatter['tools'] | undefined,
  capabilities: {
    kernel: KernelPolicy
    sandbox: SandboxPolicy
  },
): string[] | undefined => {
  const baseTools = (normalizeNativeTools(tools?.native) ?? []).filter(
    (tool) => !capabilityDerivedNativeToolNames.has(tool),
  )

  baseTools.push(...collectSandboxCapabilityTools(capabilities.sandbox))
  baseTools.push(...collectMcpCodeModeTools(tools, capabilities.sandbox))
  baseTools.push(...collectKernelCapabilityTools(capabilities.kernel))

  return baseTools.length > 0 ? baseTools : undefined
}
