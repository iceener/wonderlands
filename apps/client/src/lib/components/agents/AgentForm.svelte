<script lang="ts">
import type {
  AgentId,
  AgentKernelConfigInput,
  AgentKind,
  AgentSandboxConfigInput,
  AgentSubagentConfigInput,
  AgentVisibility,
  BackendAgentDetail,
  BackendAgentSummary,
  BackendGardenSite,
  BackendModelAlias,
  BackendModelsCatalog,
  BackendSystemRuntimeStatus,
  BackendToolProfile,
  CreateAgentApiInput,
  ProviderName,
  ReasoningEffort,
  UpdateAgentApiInput,
} from '@wonderlands/contracts/chat'
import { onDestroy, onMount, tick } from 'svelte'
/* biome-ignore lint/style/useImportType: Svelte component import is used in markup and bind:this */
import TiptapPromptEditor from '../../prompt-editor/TiptapPromptEditor.svelte'
import {
  createAgent,
  deleteAgent,
  getAgent,
  getMcpServerTools,
  getSupportedModels,
  getSystemRuntimeStatus,
  listAgents,
  listGardens,
  listMcpServers,
  listToolProfiles,
  updateAccountPreferences,
  updateAgent,
} from '../../services/api'
import { humanizeErrorMessage } from '../../services/response-errors'
import { getViewStoreContext, viewKey } from '../../stores/view-store.svelte'
import ActionButton from '../../ui/ActionButton.svelte'
import AlertBanner from '../../ui/AlertBanner.svelte'
import FieldInput from '../../ui/FieldInput.svelte'
import SectionCard from '../../ui/SectionCard.svelte'
import SegmentControl from '../../ui/SegmentControl.svelte'
import { scrollFormViewToTop } from '../../utils/scroll-form-view'

interface Props {
  agentId?: string
  currentAccountId?: string | null
}

interface AgentFormSubagent {
  agentId: AgentId
  alias: string
  description: string | null
  name: string
  slug: string
}

type AgentReasoningSelection = 'default' | ReasoningEffort
type AgentMcpMode = 'direct' | 'code'
type AgentKernelNetworkMode = NonNullable<NonNullable<AgentKernelConfigInput['network']>['mode']>
type AgentSandboxNetworkMode = NonNullable<NonNullable<AgentSandboxConfigInput['network']>['mode']>
type AgentSandboxPackageMode = NonNullable<NonNullable<AgentSandboxConfigInput['packages']>['mode']>
type AgentSandboxEngine = NonNullable<
  NonNullable<AgentSandboxConfigInput['runtime']>['defaultEngine']
>
type AgentSandboxVaultMode = NonNullable<NonNullable<AgentSandboxConfigInput['vault']>['mode']>

interface AgentFormSandboxPackageEntry {
  allowInstallScripts: boolean
  allowLo: boolean
  allowNode: boolean
  name: string
  versionRange: string
}

interface AgentFormSandboxState {
  enabled: boolean
  networkAllowedHostsText: string
  networkMode: AgentSandboxNetworkMode
  packageAllowedPackages: AgentFormSandboxPackageEntry[]
  packageAllowedRegistriesText: string
  packageMode: AgentSandboxPackageMode
  requireApprovalForDelete: boolean
  requireApprovalForMove: boolean
  requireApprovalForWorkspaceScript: boolean
  requireApprovalForWrite: boolean
  runtimeAllowAutomaticCompatFallback: boolean
  runtimeAllowedLo: boolean
  runtimeAllowedNode: boolean
  runtimeAllowWorkspaceScripts: boolean
  runtimeDefaultEngine: AgentSandboxEngine
  runtimeMaxDurationSec: string
  runtimeMaxInputBytes: string
  runtimeMaxMemoryMb: string
  runtimeMaxOutputBytes: string
  runtimeNodeVersion: string
  shellAllowedCommandsText: string
  vaultAllowedRootsText: string
  vaultMode: AgentSandboxVaultMode
}

interface AgentFormKernelState {
  browserAllowRecording: boolean
  browserDefaultViewportHeight: string
  browserDefaultViewportWidth: string
  browserMaxConcurrentSessions: string
  browserMaxDurationSec: string
  enabled: boolean
  networkAllowedHostsText: string
  networkBlockedHostsText: string
  networkMode: AgentKernelNetworkMode
  outputsAllowCookies: boolean
  outputsAllowHtml: boolean
  outputsAllowPdf: boolean
  outputsAllowRecording: boolean
  outputsAllowScreenshot: boolean
  outputsMaxOutputBytes: string
}

interface AgentFormState {
  description: string
  preferredGardenSlugs: string[]
  instructionsMd: string
  kernel: AgentFormKernelState
  kind: AgentKind
  mcpMode: AgentMcpMode
  modelAlias: string
  modelProvider: ProviderName
  name: string
  nativeTools: string[]
  reasoningEffort: AgentReasoningSelection
  revisionId: string | null
  sandbox: AgentFormSandboxState
  slug: string
  subagents: AgentFormSubagent[]
  toolProfileId: string
  visibility: Exclude<AgentVisibility, 'system'>
}

const DERIVED_SANDBOX_NATIVE_TOOLS = [
  'execute',
  'get_tools',
  'get_tool',
  'search_tools',
  'commit_sandbox_writeback',
] as const
const DERIVED_KERNEL_NATIVE_TOOLS = ['browse'] as const

const TOOL_OPTIONS: ReadonlyArray<{
  id: string
  label: string
  description: string
  requiresImageProvider?: boolean
}> = [
  {
    id: 'delegate_to_agent',
    label: 'Delegate',
    description: 'Hand off subtasks to other agents',
  },
  {
    id: 'get_garden_context',
    label: 'Garden Context',
    description: 'Look up available gardens and their structure',
  },
  {
    id: 'suspend_run',
    label: 'Suspend',
    description: 'Pause and ask the user for more information',
  },
  { id: 'web_search', label: 'Web Search', description: 'Search the web for information' },
  {
    id: 'generate_image',
    label: 'Image Generation',
    description: 'Generate images from text descriptions',
    requiresImageProvider: true,
  },
] as const
const SANDBOX_NETWORK_OPTIONS: Array<{ label: string; value: AgentSandboxNetworkMode }> = [
  { value: 'off', label: 'Off' },
  { value: 'allow_list', label: 'Allow List' },
  { value: 'open', label: 'Open' },
]
const KERNEL_NETWORK_OPTIONS: Array<{ label: string; value: AgentKernelNetworkMode }> = [
  { value: 'off', label: 'Off' },
  { value: 'allow_list', label: 'Allow List' },
  { value: 'open', label: 'Open' },
]
const SANDBOX_PACKAGE_OPTIONS: Array<{ label: string; value: AgentSandboxPackageMode }> = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'allow_list', label: 'Allow List' },
  { value: 'open', label: 'Open' },
]
const SANDBOX_ENGINE_OPTIONS: Array<{ label: string; value: AgentSandboxEngine }> = [
  { value: 'lo', label: 'lo (Preferred)' },
  { value: 'node', label: 'Node.js (Fallback)' },
]
const SANDBOX_VAULT_OPTIONS: Array<{ label: string; value: AgentSandboxVaultMode }> = [
  { value: 'none', label: 'None' },
  { value: 'read_only', label: 'Read Only' },
  { value: 'read_write', label: 'Read/Write' },
]
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

let { agentId, currentAccountId = null }: Props = $props()

const viewStore = getViewStoreContext()
const getFormView = () => ({ kind: 'agent-form' as const, ...(agentId ? { agentId } : {}) })

const createDefaultSandboxForm = (): AgentFormSandboxState => ({
  enabled: false,
  networkAllowedHostsText: '',
  networkMode: 'off',
  packageAllowedPackages: [],
  packageAllowedRegistriesText: '',
  packageMode: 'disabled',
  requireApprovalForDelete: true,
  requireApprovalForMove: true,
  requireApprovalForWorkspaceScript: true,
  requireApprovalForWrite: true,
  runtimeAllowAutomaticCompatFallback: false,
  runtimeAllowedLo: true,
  runtimeAllowedNode: false,
  runtimeAllowWorkspaceScripts: false,
  runtimeDefaultEngine: 'lo',
  runtimeMaxDurationSec: '120',
  runtimeMaxInputBytes: '25000000',
  runtimeMaxMemoryMb: '512',
  runtimeMaxOutputBytes: '25000000',
  runtimeNodeVersion: '22',
  shellAllowedCommandsText: '',
  vaultAllowedRootsText: '',
  vaultMode: 'none',
})

const createDefaultKernelForm = (): AgentFormKernelState => ({
  browserAllowRecording: false,
  browserDefaultViewportHeight: '900',
  browserDefaultViewportWidth: '1440',
  browserMaxConcurrentSessions: '1',
  browserMaxDurationSec: '60',
  enabled: false,
  networkAllowedHostsText: '',
  networkBlockedHostsText: '',
  networkMode: 'open',
  outputsAllowCookies: false,
  outputsAllowHtml: true,
  outputsAllowPdf: false,
  outputsAllowRecording: false,
  outputsAllowScreenshot: true,
  outputsMaxOutputBytes: '25000000',
})

function createEmptyForm(): AgentFormState {
  return {
    description: '',
    preferredGardenSlugs: [],
    instructionsMd: '',
    kernel: createDefaultKernelForm(),
    kind: 'specialist',
    mcpMode: 'direct',
    modelAlias: modelsCatalog?.defaultAlias ?? 'default',
    modelProvider: modelsCatalog?.defaultProvider ?? 'openai',
    name: '',
    nativeTools: ['delegate_to_agent'],
    reasoningEffort: 'medium',
    revisionId: null,
    sandbox: createDefaultSandboxForm(),
    slug: '',
    subagents: [],
    toolProfileId: '',
    visibility: 'account_private',
  }
}

let agents = $state<BackendAgentSummary[]>([])
let gardens = $state<BackendGardenSite[]>([])
let modelsCatalog = $state<BackendModelsCatalog | null>(null)
let editingAgentId = $state<AgentId | null>(null)
let form = $state<AgentFormState>(createEmptyForm())
let fieldErrors = $state<Record<string, string>>({})
let errorMessage = $state('')
let successMessage = $state('')
let instructionsEditor: TiptapPromptEditor | null = $state(null)
let isLoadingDetail = $state(false)
let isLoadingModels = $state(false)
let isSaving = $state(false)
let isSettingDefault = $state(false)
let isDefaultForAccount = $state(false)
let deletingAgentId = $state<string | null>(null)
let availableToolProfiles = $state<BackendToolProfile[]>([])
let isLoadingToolProfiles = $state(false)
let runtimeStatus = $state<BackendSystemRuntimeStatus | null>(null)
let formRoot: HTMLElement | undefined = $state()
const sandboxHasAdvancedValues = $derived.by(
  () =>
    form.sandbox.packageMode !== 'disabled' ||
    form.sandbox.shellAllowedCommandsText.trim() !== '' ||
    form.sandbox.runtimeAllowWorkspaceScripts ||
    form.sandbox.runtimeMaxDurationSec !== '120' ||
    form.sandbox.runtimeMaxMemoryMb !== '512' ||
    form.sandbox.runtimeMaxInputBytes !== '25000000' ||
    form.sandbox.runtimeMaxOutputBytes !== '25000000',
)
const browserHasAdvancedValues = $derived.by(
  () =>
    form.kernel.browserDefaultViewportWidth !== '1440' ||
    form.kernel.browserDefaultViewportHeight !== '900' ||
    form.kernel.browserMaxDurationSec !== '60' ||
    form.kernel.browserMaxConcurrentSessions !== '1' ||
    form.kernel.browserAllowRecording ||
    !form.kernel.outputsAllowScreenshot ||
    !form.kernel.outputsAllowHtml ||
    form.kernel.outputsAllowPdf ||
    form.kernel.outputsAllowCookies ||
    form.kernel.outputsAllowRecording ||
    form.kernel.outputsMaxOutputBytes !== '25000000',
)
let sandboxAdvancedOpen = $state(false)
let browserAdvancedOpen = $state(false)
let loadedFormSnapshot = $state<string>('')
let hasStaleSubagentIds = $state(false)
const selectedToolProfile = $derived.by(
  () => availableToolProfiles.find((profile) => profile.id === form.toolProfileId) ?? null,
)
const formFingerprint = $derived(
  JSON.stringify([
    form.name,
    form.description,
    form.preferredGardenSlugs,
    form.kind,
    form.kernel,
    form.mcpMode,
    form.modelAlias,
    form.modelProvider,
    form.nativeTools,
    form.reasoningEffort,
    form.sandbox,
    form.slug,
    form.subagents,
    form.toolProfileId,
    form.visibility,
    form.instructionsMd,
  ]),
)
const formIsDirty = $derived(
  hasStaleSubagentIds || (loadedFormSnapshot !== '' && formFingerprint !== loadedFormSnapshot),
)

interface ToolPreviewGroup {
  serverLabel: string
  tools: { title: string }[]
}
let toolPreviewGroups = $state<ToolPreviewGroup[]>([])
let isLoadingToolPreview = $state(false)
const toolPreviewSummary = $derived.by(() => {
  const totalTools = toolPreviewGroups.reduce((sum, g) => sum + g.tools.length, 0)
  if (totalTools === 0) return 'No tools assigned'
  return `${totalTools} tool${totalTools === 1 ? '' : 's'} from ${toolPreviewGroups.length} server${toolPreviewGroups.length === 1 ? '' : 's'}`
})
const kernelRuntimeNotice = $derived.by(() => {
  const kernel = runtimeStatus?.kernel

  if (!kernel) {
    return null
  }

  if (!kernel.enabled) {
    return {
      tone: 'muted' as const,
      text: 'Kernel is disabled on the server. You can still save browser policy here, but `browse` will stay unavailable until Kernel is enabled.',
    }
  }

  if (kernel.status === 'ready' && kernel.available) {
    return {
      tone: 'ready' as const,
      text: `Kernel is connected (${kernel.provider}). Browser jobs are currently available when this agent has browser access.`,
    }
  }

  if (kernel.status === 'pending') {
    return {
      tone: 'muted' as const,
      text: 'Kernel is enabled but has not finished probing yet. Browser policy can be saved now, but runtime availability is still pending.',
    }
  }

  return {
    tone: 'warning' as const,
    text: `Kernel is enabled but currently unavailable. ${kernel.detail}`,
  }
})
const sandboxRuntimeNotice = $derived.by(() => {
  const sandbox = runtimeStatus?.sandbox

  if (!sandbox) {
    return null
  }

  if (!sandbox.available) {
    return {
      tone: 'warning' as const,
      text: sandbox.detail,
    }
  }

  if (sandbox.supportedRuntimes.includes('lo') && sandbox.supportedRuntimes.includes('node')) {
    return {
      tone: 'ready' as const,
      text: `Sandbox provider ${sandbox.provider} supports lo and node. lo is the preferred runtime; Node.js is the fallback for packages and compatibility gaps.`,
    }
  }

  if (sandbox.supportedRuntimes.includes('lo')) {
    return {
      tone: 'ready' as const,
      text: `Sandbox provider ${sandbox.provider} currently supports lo only. Package-backed jobs still require Node.js.`,
    }
  }

  return {
    tone: 'warning' as const,
    text: `Sandbox provider ${sandbox.provider} currently supports ${sandbox.supportedRuntimes.join(', ')} only. lo-specific controls can still be saved here, but only Node.js jobs can run on this server.`,
  }
})
const sandboxEngineHelpText = $derived.by(() => {
  if (form.sandbox.runtimeAllowedLo && form.sandbox.runtimeAllowedNode) {
    return 'lo is the preferred sandbox path. Node.js is the fallback for packages and other compatibility gaps.'
  }

  if (form.sandbox.runtimeAllowedLo) {
    return 'lo is enabled as the preferred sandbox path. Package-backed execution still requires Node.js.'
  }

  if (form.sandbox.runtimeAllowedNode) {
    return 'Node.js is enabled as the active fallback runtime. Some controls below still describe lo / just-bash-only behavior.'
  }

  return 'Allow at least one sandbox runtime.'
})
const sandboxPackageWarnings = $derived.by(() => {
  const warnings: string[] = []

  if (form.sandbox.packageMode !== 'disabled' && !form.sandbox.runtimeAllowedNode) {
    warnings.push(
      'Packages currently require Node.js. Enable the Node.js fallback engine or disable packages.',
    )
  }

  if (form.sandbox.packageAllowedPackages.some((entry) => entry.allowLo)) {
    warnings.push(
      'Package rows targeting lo will not run yet. Packages currently execute on Node.js only.',
    )
  }

  if (
    runtimeStatus?.sandbox?.provider === 'local_dev' &&
    form.sandbox.packageAllowedPackages.some((entry) => entry.allowInstallScripts)
  ) {
    warnings.push('The current local_dev sandbox runner blocks packages with install scripts.')
  }

  return warnings
})
const sandboxShellAllowListHelpText = $derived.by(() =>
  form.sandbox.runtimeAllowedLo
    ? 'Currently enforced in lo / just-bash. Leave empty for the default set.'
    : 'Currently enforced only in lo / just-bash. This agent does not currently allow lo.',
)

const applySandboxRuntimeAvailabilityDefaults = () => {
  const supportedRuntimes = runtimeStatus?.sandbox?.supportedRuntimes ?? []

  if (
    agentId ||
    supportedRuntimes.length === 0 ||
    supportedRuntimes.includes('lo') ||
    !supportedRuntimes.includes('node')
  ) {
    return
  }

  if (
    form.sandbox.runtimeDefaultEngine === 'lo' &&
    form.sandbox.runtimeAllowedLo &&
    !form.sandbox.runtimeAllowedNode
  ) {
    form.sandbox.runtimeAllowedLo = false
    form.sandbox.runtimeAllowedNode = true
    form.sandbox.runtimeDefaultEngine = 'node'
    form.sandbox.runtimeAllowAutomaticCompatFallback = false
  }
}

const syncSandboxEngineState = () => {
  if (!form.sandbox.runtimeAllowedLo && form.sandbox.runtimeDefaultEngine === 'lo') {
    form.sandbox.runtimeDefaultEngine = form.sandbox.runtimeAllowedNode ? 'node' : 'lo'
  }

  if (!form.sandbox.runtimeAllowedNode && form.sandbox.runtimeDefaultEngine === 'node') {
    form.sandbox.runtimeDefaultEngine = form.sandbox.runtimeAllowedLo ? 'lo' : 'node'
  }

  if (!form.sandbox.runtimeAllowedNode) {
    form.sandbox.runtimeAllowAutomaticCompatFallback = false
  }
}

const setSandboxDefaultEngine = (value: AgentSandboxEngine) => {
  form.sandbox.runtimeDefaultEngine = value

  if (value === 'lo') {
    form.sandbox.runtimeAllowedLo = true
  } else {
    form.sandbox.runtimeAllowedNode = true
  }

  syncSandboxEngineState()
  delete fieldErrors['sandbox.runtime.allowedEngines']
  delete fieldErrors['sandbox.runtime.allowAutomaticCompatFallback']
  delete fieldErrors['sandbox.runtime.defaultEngine']
  delete fieldErrors['sandbox.packages.mode']
  delete fieldErrors['sandbox.packages.allowedPackages']
  delete fieldErrors['sandbox.shell.allowedCommands']
}

const toggleSandboxAllowedEngine = (engine: AgentSandboxEngine) => {
  if (engine === 'lo') {
    form.sandbox.runtimeAllowedLo = !form.sandbox.runtimeAllowedLo
  } else {
    form.sandbox.runtimeAllowedNode = !form.sandbox.runtimeAllowedNode
  }

  syncSandboxEngineState()
  delete fieldErrors['sandbox.runtime.allowedEngines']
  delete fieldErrors['sandbox.runtime.allowAutomaticCompatFallback']
  delete fieldErrors['sandbox.runtime.defaultEngine']
  delete fieldErrors['sandbox.packages.mode']
  delete fieldErrors['sandbox.packages.allowedPackages']
  delete fieldErrors['sandbox.shell.allowedCommands']
}

const loadToolPreview = async (profileId: string) => {
  isLoadingToolPreview = true
  try {
    const servers = await listMcpServers()
    const groups: ToolPreviewGroup[] = []
    for (const server of servers) {
      try {
        const result = await getMcpServerTools(server.id, { toolProfileId: profileId })
        const assigned = result.tools.filter((t) => t.modelVisible && t.assignment)
        if (assigned.length > 0) {
          groups.push({
            serverLabel: result.server.label,
            tools: assigned.map((t) => ({ title: t.title?.trim() || t.remoteName })),
          })
        }
      } catch {
        /* skip */
      }
    }
    toolPreviewGroups = groups
  } catch {
    toolPreviewGroups = []
  } finally {
    isLoadingToolPreview = false
  }
}

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/g, '')
    .replace(/-+$/g, '')

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const getString = (value: unknown): string => (typeof value === 'string' ? value : '')
const getBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined
const getNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const getStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((e): e is string => typeof e === 'string') : []
const normalizePreferredGardenSlugs = (value: string[]): string[] =>
  Array.from(new Set(value.map((entry) => entry.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )
const normalizeLineList = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  )
const normalizeHostEntry = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
const isSandboxEngine = (value: string): value is AgentSandboxEngine =>
  value === 'lo' || value === 'node'
const createEmptySandboxPackage = (): AgentFormSandboxPackageEntry => ({
  allowInstallScripts: false,
  allowLo: false,
  allowNode: form?.sandbox?.runtimeAllowedNode ?? false,
  name: '',
  versionRange: '',
})
const normalizeVaultRoot = (value: string): string | null => {
  let normalized = value
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .trim()

  if (!normalized) {
    return null
  }

  if (normalized === 'vault') {
    normalized = '/vault'
  } else if (normalized.startsWith('vault/')) {
    normalized = `/${normalized}`
  }

  if (normalized !== '/vault' && !normalized.startsWith('/vault/')) {
    return null
  }

  const segments = normalized.split('/').filter(Boolean)

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return null
  }

  return normalized === '/vault' ? normalized : normalized.replace(/\/+$/, '')
}
const parsePositiveIntegerInput = (
  value: string,
  fieldKey: string,
  label: string,
  nextErrors: Record<string, string>,
): number | undefined => {
  const trimmed = value.trim()

  if (!trimmed) {
    return undefined
  }

  if (!/^\d+$/.test(trimmed)) {
    nextErrors[fieldKey] = `${label} must be a positive integer.`
    return undefined
  }

  const parsed = Number.parseInt(trimmed, 10)

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    nextErrors[fieldKey] = `${label} must be a positive integer.`
    return undefined
  }

  return parsed
}
const parseSandboxForm = (value: unknown): AgentFormSandboxState => {
  const sandbox = toRecord(value)
  const network = toRecord(sandbox.network)
  const packages = toRecord(sandbox.packages)
  const runtime = toRecord(sandbox.runtime)
  const shell = toRecord(sandbox.shell)
  const vault = toRecord(sandbox.vault)
  const runtimeAllowedEngines = getStringArray(runtime.allowedEngines).filter(isSandboxEngine)
  let runtimeAllowedLo = runtimeAllowedEngines.includes('lo')
  let runtimeAllowedNode = runtimeAllowedEngines.includes('node')
  const runtimeDefaultEngineValue = getString(runtime.defaultEngine)

  if (runtimeAllowedEngines.length === 0) {
    if (runtimeDefaultEngineValue === 'lo') {
      runtimeAllowedLo = true
    } else {
      runtimeAllowedNode = true
    }
  }

  let runtimeDefaultEngine: AgentSandboxEngine =
    runtimeDefaultEngineValue === 'lo' || runtimeDefaultEngineValue === 'node'
      ? runtimeDefaultEngineValue
      : runtimeAllowedLo
        ? 'lo'
        : 'node'

  if (runtimeDefaultEngine === 'lo' && !runtimeAllowedLo) {
    runtimeDefaultEngine = runtimeAllowedNode ? 'node' : 'lo'
  }

  if (runtimeDefaultEngine === 'node' && !runtimeAllowedNode) {
    runtimeDefaultEngine = runtimeAllowedLo ? 'lo' : 'node'
  }

  const allowedPackages = Array.isArray(packages.allowedPackages)
    ? packages.allowedPackages
        .map((entry) => {
          const record = toRecord(entry)
          const packageRuntimes = getStringArray(record.runtimes).filter(isSandboxEngine)
          const hasRuntimeRestriction = Array.isArray(record.runtimes)
          return {
            allowInstallScripts: getBoolean(record.allowInstallScripts) ?? false,
            allowLo: hasRuntimeRestriction ? packageRuntimes.includes('lo') : runtimeAllowedLo,
            allowNode: hasRuntimeRestriction
              ? packageRuntimes.includes('node')
              : runtimeAllowedNode,
            name: getString(record.name),
            versionRange: getString(record.versionRange),
          }
        })
        .filter(
          (entry) =>
            entry.name ||
            entry.versionRange ||
            entry.allowInstallScripts ||
            !entry.allowLo ||
            !entry.allowNode,
        )
    : []

  return {
    enabled: getBoolean(sandbox.enabled) ?? false,
    networkAllowedHostsText: getStringArray(network.allowedHosts).join('\n'),
    networkMode: (network.mode as AgentSandboxNetworkMode | undefined) ?? 'off',
    packageAllowedPackages: allowedPackages,
    packageAllowedRegistriesText: getStringArray(packages.allowedRegistries).join('\n'),
    packageMode: (packages.mode as AgentSandboxPackageMode | undefined) ?? 'disabled',
    requireApprovalForDelete: getBoolean(vault.requireApprovalForDelete) ?? true,
    requireApprovalForMove: getBoolean(vault.requireApprovalForMove) ?? true,
    requireApprovalForWorkspaceScript: getBoolean(vault.requireApprovalForWorkspaceScript) ?? true,
    requireApprovalForWrite: getBoolean(vault.requireApprovalForWrite) ?? true,
    runtimeAllowAutomaticCompatFallback: getBoolean(runtime.allowAutomaticCompatFallback) ?? false,
    runtimeAllowedLo,
    runtimeAllowedNode,
    runtimeAllowWorkspaceScripts: getBoolean(runtime.allowWorkspaceScripts) ?? false,
    runtimeDefaultEngine,
    runtimeMaxDurationSec: String(getNumber(runtime.maxDurationSec) ?? 120),
    runtimeMaxInputBytes: String(getNumber(runtime.maxInputBytes) ?? 25000000),
    runtimeMaxMemoryMb: String(getNumber(runtime.maxMemoryMb) ?? 512),
    runtimeMaxOutputBytes: String(getNumber(runtime.maxOutputBytes) ?? 25000000),
    runtimeNodeVersion: getString(runtime.nodeVersion) || '22',
    shellAllowedCommandsText: getStringArray(shell.allowedCommands).join('\n'),
    vaultAllowedRootsText: getStringArray(vault.allowedRoots).join('\n'),
    vaultMode: (vault.mode as AgentSandboxVaultMode | undefined) ?? 'none',
  }
}

const parseKernelForm = (value: unknown): AgentFormKernelState => {
  const kernel = toRecord(value)
  const browser = toRecord(kernel.browser)
  const defaultViewport = toRecord(browser.defaultViewport)
  const network = toRecord(kernel.network)
  const outputs = toRecord(kernel.outputs)

  return {
    browserAllowRecording: getBoolean(browser.allowRecording) ?? false,
    browserDefaultViewportHeight: String(getNumber(defaultViewport.height) ?? 900),
    browserDefaultViewportWidth: String(getNumber(defaultViewport.width) ?? 1440),
    browserMaxConcurrentSessions: String(getNumber(browser.maxConcurrentSessions) ?? 1),
    browserMaxDurationSec: String(getNumber(browser.maxDurationSec) ?? 60),
    enabled: getBoolean(kernel.enabled) ?? false,
    networkAllowedHostsText: getStringArray(network.allowedHosts).join('\n'),
    networkBlockedHostsText: getStringArray(network.blockedHosts).join('\n'),
    networkMode: (network.mode as AgentKernelNetworkMode | undefined) ?? 'open',
    outputsAllowCookies: getBoolean(outputs.allowCookies) ?? false,
    outputsAllowHtml: getBoolean(outputs.allowHtml) ?? true,
    outputsAllowPdf: getBoolean(outputs.allowPdf) ?? false,
    outputsAllowRecording: getBoolean(outputs.allowRecording) ?? false,
    outputsAllowScreenshot: getBoolean(outputs.allowScreenshot) ?? true,
    outputsMaxOutputBytes: String(getNumber(outputs.maxOutputBytes) ?? 25000000),
  }
}

const buildSandboxPayload = (
  sandbox: AgentFormSandboxState,
  nextErrors: Record<string, string>,
): AgentSandboxConfigInput => {
  const assignError = (fieldKey: string, message: string) => {
    if (!nextErrors[fieldKey]) {
      nextErrors[fieldKey] = message
    }
  }
  const allowedHosts = normalizeLineList(sandbox.networkAllowedHostsText).map(normalizeHostEntry)
  const allowedRegistries = normalizeLineList(sandbox.packageAllowedRegistriesText).map(
    normalizeHostEntry,
  )
  const allowedRoots: string[] = []
  const allowedCommands = normalizeLineList(sandbox.shellAllowedCommandsText)
  const allowedEngines: AgentSandboxEngine[] = []

  if (sandbox.runtimeAllowedLo) {
    allowedEngines.push('lo')
  }

  if (sandbox.runtimeAllowedNode) {
    allowedEngines.push('node')
  }

  if (allowedEngines.length === 0) {
    nextErrors['sandbox.runtime.allowedEngines'] = 'Allow at least one sandbox engine.'
  }

  if (allowedEngines.length > 0 && !allowedEngines.includes(sandbox.runtimeDefaultEngine)) {
    nextErrors['sandbox.runtime.defaultEngine'] =
      'Default engine must be one of the allowed engines.'
  }

  if (sandbox.runtimeAllowAutomaticCompatFallback && !allowedEngines.includes('node')) {
    nextErrors['sandbox.runtime.allowAutomaticCompatFallback'] =
      'Automatic compatibility fallback requires Node to be allowed.'
  }

  if (sandbox.packageMode !== 'disabled' && !allowedEngines.includes('node')) {
    assignError(
      'sandbox.packages.mode',
      'Packages currently require Node.js to be allowed for this agent.',
    )
  }

  if (allowedCommands.length > 0 && !allowedEngines.includes('lo')) {
    assignError(
      'sandbox.shell.allowedCommands',
      'Shell command allow list is currently enforced only in lo / just-bash. Allow lo or clear this list.',
    )
  }

  const supportedSandboxRuntimes = runtimeStatus?.sandbox?.supportedRuntimes ?? []

  if (sandbox.enabled && runtimeStatus?.sandbox) {
    if (supportedSandboxRuntimes.length === 0) {
      nextErrors['sandbox.runtime.allowedEngines'] =
        'The current sandbox backend does not report any runnable sandbox runtimes.'
    } else {
      const unsupportedAllowedEngines = allowedEngines.filter(
        (engine) => !supportedSandboxRuntimes.includes(engine),
      )

      if (unsupportedAllowedEngines.length > 0) {
        nextErrors['sandbox.runtime.allowedEngines'] =
          `The current sandbox backend supports ${supportedSandboxRuntimes.join(', ')}. Remove unsupported engines: ${unsupportedAllowedEngines.join(', ')}.`
      }

      if (!supportedSandboxRuntimes.includes(sandbox.runtimeDefaultEngine)) {
        nextErrors['sandbox.runtime.defaultEngine'] =
          `Default engine ${sandbox.runtimeDefaultEngine} is not runnable on the current sandbox backend.`
      }
    }
  }

  for (const root of normalizeLineList(sandbox.vaultAllowedRootsText)) {
    const normalized = normalizeVaultRoot(root)

    if (!normalized) {
      nextErrors['sandbox.vault.allowedRoots'] =
        'Vault roots must use /vault paths and cannot contain traversal.'
      continue
    }

    allowedRoots.push(normalized)
  }

  const allowedPackages: NonNullable<AgentSandboxConfigInput['packages']>['allowedPackages'] = []

  for (const [index, entry] of sandbox.packageAllowedPackages.entries()) {
    const name = entry.name.trim()
    const versionRange = entry.versionRange.trim()
    const runtimes: AgentSandboxEngine[] = []

    if (entry.allowLo) {
      runtimes.push('lo')
    }

    if (entry.allowNode) {
      runtimes.push('node')
    }

    if (!name && !versionRange) {
      continue
    }

    if (entry.allowLo) {
      assignError(
        'sandbox.packages.allowedPackages',
        `Package row ${index + 1} cannot target lo yet. Packages currently execute on Node.js only.`,
      )
      continue
    }

    if (entry.allowInstallScripts && runtimeStatus?.sandbox?.provider === 'local_dev') {
      assignError(
        'sandbox.packages.allowedPackages',
        `Package row ${index + 1} enables install scripts, but the current local_dev sandbox runner blocks them.`,
      )
      continue
    }

    if (!name || !versionRange) {
      nextErrors['sandbox.packages.allowedPackages'] =
        `Package row ${index + 1} needs both a name and version range.`
      continue
    }

    if (runtimes.length === 0) {
      nextErrors['sandbox.packages.allowedPackages'] =
        `Package row ${index + 1} must allow at least one runtime.`
      continue
    }

    allowedPackages.push({
      allowInstallScripts: entry.allowInstallScripts,
      name,
      runtimes,
      versionRange,
    })
  }

  const maxDurationSec = parsePositiveIntegerInput(
    sandbox.runtimeMaxDurationSec,
    'sandbox.runtime.maxDurationSec',
    'Max duration',
    nextErrors,
  )
  const maxInputBytes = parsePositiveIntegerInput(
    sandbox.runtimeMaxInputBytes,
    'sandbox.runtime.maxInputBytes',
    'Max input bytes',
    nextErrors,
  )
  const maxMemoryMb = parsePositiveIntegerInput(
    sandbox.runtimeMaxMemoryMb,
    'sandbox.runtime.maxMemoryMb',
    'Max memory',
    nextErrors,
  )
  const maxOutputBytes = parsePositiveIntegerInput(
    sandbox.runtimeMaxOutputBytes,
    'sandbox.runtime.maxOutputBytes',
    'Max output bytes',
    nextErrors,
  )
  const nodeVersion = sandbox.runtimeNodeVersion.trim()

  return {
    enabled: sandbox.enabled,
    network: {
      mode: sandbox.networkMode,
      ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
    },
    packages: {
      mode: sandbox.packageMode,
      ...(allowedPackages.length > 0 ? { allowedPackages } : {}),
      ...(allowedRegistries.length > 0 ? { allowedRegistries } : {}),
    },
    runtime: {
      allowAutomaticCompatFallback: sandbox.runtimeAllowAutomaticCompatFallback,
      ...(allowedEngines.length > 0 ? { allowedEngines } : {}),
      allowWorkspaceScripts: sandbox.runtimeAllowWorkspaceScripts,
      defaultEngine: sandbox.runtimeDefaultEngine,
      ...(maxDurationSec !== undefined ? { maxDurationSec } : {}),
      ...(maxInputBytes !== undefined ? { maxInputBytes } : {}),
      ...(maxMemoryMb !== undefined ? { maxMemoryMb } : {}),
      ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
      ...(allowedEngines.includes('node') && nodeVersion ? { nodeVersion } : {}),
    },
    ...(allowedCommands.length > 0
      ? {
          shell: {
            allowedCommands,
          },
        }
      : {}),
    vault: {
      mode: sandbox.vaultMode,
      ...(allowedRoots.length > 0 ? { allowedRoots } : {}),
      requireApprovalForDelete: sandbox.requireApprovalForDelete,
      requireApprovalForMove: sandbox.requireApprovalForMove,
      requireApprovalForWorkspaceScript: sandbox.requireApprovalForWorkspaceScript,
      requireApprovalForWrite: sandbox.requireApprovalForWrite,
    },
  }
}

const buildKernelPayload = (
  kernel: AgentFormKernelState,
  nextErrors: Record<string, string>,
): AgentKernelConfigInput => {
  const allowedHosts = normalizeLineList(kernel.networkAllowedHostsText).map(normalizeHostEntry)
  const blockedHosts = normalizeLineList(kernel.networkBlockedHostsText).map(normalizeHostEntry)
  const defaultViewportHeight = parsePositiveIntegerInput(
    kernel.browserDefaultViewportHeight,
    'kernel.browser.defaultViewport.height',
    'Default viewport height',
    nextErrors,
  )
  const defaultViewportWidth = parsePositiveIntegerInput(
    kernel.browserDefaultViewportWidth,
    'kernel.browser.defaultViewport.width',
    'Default viewport width',
    nextErrors,
  )
  const maxConcurrentSessions = parsePositiveIntegerInput(
    kernel.browserMaxConcurrentSessions,
    'kernel.browser.maxConcurrentSessions',
    'Max concurrent sessions',
    nextErrors,
  )
  const maxDurationSec = parsePositiveIntegerInput(
    kernel.browserMaxDurationSec,
    'kernel.browser.maxDurationSec',
    'Max browser duration',
    nextErrors,
  )
  const maxOutputBytes = parsePositiveIntegerInput(
    kernel.outputsMaxOutputBytes,
    'kernel.outputs.maxOutputBytes',
    'Max browser output bytes',
    nextErrors,
  )

  return {
    browser: {
      allowRecording: kernel.browserAllowRecording,
      ...(defaultViewportHeight !== undefined && defaultViewportWidth !== undefined
        ? {
            defaultViewport: {
              height: defaultViewportHeight,
              width: defaultViewportWidth,
            },
          }
        : {}),
      ...(maxConcurrentSessions !== undefined ? { maxConcurrentSessions } : {}),
      ...(maxDurationSec !== undefined ? { maxDurationSec } : {}),
    },
    enabled: kernel.enabled,
    network: {
      mode: kernel.networkMode,
      ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
      ...(blockedHosts.length > 0 ? { blockedHosts } : {}),
    },
    outputs: {
      allowCookies: kernel.outputsAllowCookies,
      allowHtml: kernel.outputsAllowHtml,
      allowPdf: kernel.outputsAllowPdf,
      allowRecording: kernel.outputsAllowRecording,
      allowScreenshot: kernel.outputsAllowScreenshot,
      ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
    },
  }
}

const normalizeNativeTools = (value: string[]): string[] => {
  const normalized: string[] = []

  for (const tool of value) {
    const nextTool = tool === 'block_run' || tool === 'complete_run' ? 'suspend_run' : tool

    if (!normalized.includes(nextTool)) {
      normalized.push(nextTool)
    }
  }

  return normalized
}

const stripDerivedCapabilityNativeTools = (value: string[]): string[] =>
  value.filter(
    (tool) =>
      !(DERIVED_SANDBOX_NATIVE_TOOLS as readonly string[]).includes(tool) &&
      !(DERIVED_KERNEL_NATIVE_TOOLS as readonly string[]).includes(tool),
  )

const availableSubagents = $derived.by(() => agents.filter((a) => a.id !== editingAgentId))
const availableGardens = $derived.by(() =>
  [...gardens].sort(
    (left, right) =>
      Number(right.isDefault) - Number(left.isDefault) ||
      left.slug.localeCompare(right.slug) ||
      left.id.localeCompare(right.id),
  ),
)

const providerAliases = $derived.by((): BackendModelAlias[] =>
  modelsCatalog ? modelsCatalog.aliases.filter((a) => a.provider === form.modelProvider) : [],
)

const selectedAliasEntry = $derived.by(
  (): BackendModelAlias | null => providerAliases.find((a) => a.alias === form.modelAlias) ?? null,
)

const getReasoningOptionsForAlias = (
  alias: BackendModelAlias | null,
  provider: ProviderName,
): AgentReasoningSelection[] => {
  if (!alias?.supportsReasoning) {
    return []
  }

  if (provider === 'google') {
    return ['default', ...new Set(alias.reasoningModes)]
  }

  return alias.reasoningModes
}

const pickReasoningSelection = (
  alias: BackendModelAlias | null,
  provider: ProviderName,
  current?: AgentReasoningSelection,
): AgentReasoningSelection => {
  const options = getReasoningOptionsForAlias(alias, provider)

  if (current && options.includes(current)) {
    return current
  }

  if (provider === 'google') {
    return 'default'
  }

  if (options.includes('medium')) {
    return 'medium'
  }

  return options[0] ?? 'none'
}

const availableReasoningModes = $derived.by((): AgentReasoningSelection[] =>
  getReasoningOptionsForAlias(selectedAliasEntry, form.modelProvider),
)
const imageGenerationConfigured = $derived.by(() =>
  Boolean(
    modelsCatalog?.providers.google.configured ||
      modelsCatalog?.providers.openai.configured ||
      modelsCatalog?.providers.openrouter.configured,
  ),
)

const reasoningLabel = 'Reasoning Level'

const openaiDescriptions: Record<AgentReasoningSelection, string> = {
  default: 'Use the provider default reasoning behavior',
  none: 'No reasoning. Fastest, cheapest. Only gpt-5.1+',
  minimal: 'Very light reasoning for most queries',
  low: 'Quick reasoning, lower latency',
  medium: 'Balanced reasoning (default for most models)',
  high: 'Deep reasoning, slower first token',
  xhigh: 'Maximum depth. Only codex-max models',
}

const googleDescriptions: Record<AgentReasoningSelection, string> = {
  default: "Use Gemini's default thinking behavior",
  none: 'Disable thinking for the lowest latency and cost',
  minimal: 'Use the provider default thinking behavior',
  low: 'Use the provider default thinking behavior',
  medium: 'Use the provider default thinking behavior',
  high: 'Use the provider default thinking behavior',
  xhigh: 'Use the provider default thinking behavior',
}

const getModeLabel = (mode: AgentReasoningSelection): string => {
  if (mode === 'default') return 'Provider default'
  if (mode === 'none') return 'No reasoning'
  return mode
}

const getModeDescription = (mode: AgentReasoningSelection): string => {
  if (form.modelProvider === 'google') return googleDescriptions[mode] ?? mode
  return openaiDescriptions[mode] ?? mode
}

const populateForm = (detail: BackendAgentDetail) => {
  const frontmatter = toRecord(detail.activeRevision?.frontmatterJson)
  const frontmatterGarden = toRecord(frontmatter.garden)
  const gardenFocus = toRecord(detail.activeRevision?.gardenFocusJson)
  const modelConfig = toRecord(detail.activeRevision?.modelConfigJson)
  const reasoningConfig = toRecord(modelConfig.reasoning)
  const toolPolicy = toRecord(detail.activeRevision?.toolPolicyJson)
  const parsedModelProvider = getString(modelConfig.provider)
  const modelProvider: ProviderName =
    parsedModelProvider === 'google' ||
    parsedModelProvider === 'openrouter' ||
    parsedModelProvider === 'openai'
      ? parsedModelProvider
      : 'openai'
  const modelAlias = getString(modelConfig.modelAlias) || modelsCatalog?.defaultAlias || 'default'
  const resolvedAlias =
    modelsCatalog?.aliases.find(
      (alias) => alias.provider === modelProvider && alias.alias === modelAlias,
    ) ?? null
  const persistedReasoning = getString(reasoningConfig.effort) as ReasoningEffort | undefined
  const initialReasoning =
    modelProvider === 'google'
      ? persistedReasoning === 'none'
        ? ('none' as const)
        : ('default' as const)
      : ((persistedReasoning as ReasoningEffort | undefined) ?? 'medium')
  const persistedToolProfileId = detail.activeRevision?.toolProfileId?.trim() || ''

  hasStaleSubagentIds = false

  form = {
    description: detail.description ?? '',
    preferredGardenSlugs: normalizePreferredGardenSlugs(
      getStringArray(gardenFocus.preferredSlugs).length > 0
        ? getStringArray(gardenFocus.preferredSlugs)
        : getStringArray(frontmatterGarden.preferred_slugs),
    ),
    instructionsMd: detail.activeRevision?.instructionsMd ?? '',
    kernel: parseKernelForm(detail.activeRevision?.kernelPolicyJson),
    kind: detail.kind,
    mcpMode: toolPolicy.mcpMode === 'code' ? 'code' : 'direct',
    modelAlias,
    modelProvider,
    name: detail.name,
    nativeTools: normalizeNativeTools(
      stripDerivedCapabilityNativeTools(getStringArray(toolPolicy.native)),
    ),
    reasoningEffort: pickReasoningSelection(resolvedAlias, modelProvider, initialReasoning),
    revisionId: detail.activeRevision?.id ?? null,
    sandbox: parseSandboxForm(detail.activeRevision?.sandboxPolicyJson),
    slug: detail.slug,
    subagents: detail.subagents.map((s) => {
      const liveMatch =
        agents.find((a) => a.id === s.childAgentId) ?? agents.find((a) => a.slug === s.childSlug)
      if (liveMatch && liveMatch.id !== s.childAgentId) {
        hasStaleSubagentIds = true
      }
      return {
        agentId: liveMatch?.id ?? s.childAgentId,
        alias: s.alias,
        description: s.childDescription,
        name: liveMatch?.name ?? s.childName,
        slug: liveMatch?.slug ?? s.childSlug,
      }
    }),
    toolProfileId: persistedToolProfileId,
    visibility: detail.visibility === 'tenant_shared' ? 'tenant_shared' : 'account_private',
  }
  isDefaultForAccount = detail.isDefaultForAccount
  if (form.toolProfileId) {
    void loadToolPreview(form.toolProfileId)
  }
}

const selectAlias = (alias: BackendModelAlias) => {
  form.modelAlias = alias.alias
  delete fieldErrors.modelAlias
  form.reasoningEffort = pickReasoningSelection(alias, form.modelProvider, form.reasoningEffort)
}

const buildPayload = (): CreateAgentApiInput | UpdateAgentApiInput | null => {
  const nextErrors: Record<string, string> = {}
  const trimmedDescription = form.description.trim()
  const preferredGardenSlugs = normalizePreferredGardenSlugs(form.preferredGardenSlugs)
  const trimmedName = form.name.trim()
  const trimmedInstructions =
    instructionsEditor?.getMarkdown()?.trim() ?? form.instructionsMd.trim()
  const trimmedAlias = form.modelAlias.trim()
  const trimmedToolProfileId = form.toolProfileId.trim() || null
  const kernel = buildKernelPayload(form.kernel, nextErrors)
  const sandbox = buildSandboxPayload(form.sandbox, nextErrors)
  const resolvedNativeTools = normalizeNativeTools([
    ...stripDerivedCapabilityNativeTools(form.nativeTools),
    ...(kernel.enabled ? ['browse'] : []),
    ...(sandbox.enabled ? ['execute'] : []),
    ...(sandbox.enabled && sandbox.vault?.mode === 'read_write'
      ? ['commit_sandbox_writeback']
      : []),
  ])
  const sanitizedSubagents: AgentSubagentConfigInput[] = []
  const generatedSlug = slugify(trimmedName)

  if (!trimmedName) nextErrors.name = 'Name is required.'
  if (!generatedSlug || !SLUG_PATTERN.test(generatedSlug))
    nextErrors.name = 'Name must start with a letter or number.'
  if (!trimmedInstructions) nextErrors.instructionsMd = 'Instructions are required.'
  if (!trimmedAlias) nextErrors.modelAlias = 'Model alias is required.'
  if (editingAgentId && !form.revisionId) nextErrors.revisionId = 'Revision could not be resolved.'
  if (form.mcpMode === 'code' && !sandbox?.enabled) {
    nextErrors.mcpMode = 'Enable sandbox jobs to use MCP code mode.'
  }

  for (const subagent of form.subagents) {
    const alias = subagent.slug
    sanitizedSubagents.push({ alias, mode: 'async_join', slug: subagent.slug })
  }

  fieldErrors = nextErrors
  if (Object.keys(nextErrors).length > 0) return null

  const base: CreateAgentApiInput = {
    description: trimmedDescription,
    ...(preferredGardenSlugs.length > 0
      ? {
          garden: {
            preferredSlugs: preferredGardenSlugs,
          },
        }
      : {}),
    instructionsMd: trimmedInstructions,
    kind: form.kind,
    kernel,
    model: {
      modelAlias: trimmedAlias,
      provider: form.modelProvider,
      ...(form.reasoningEffort === 'default'
        ? {}
        : {
            reasoning: {
              effort: form.reasoningEffort,
            },
          }),
    },
    name: trimmedName,
    sandbox,
    slug: editingAgentId ? form.slug : generatedSlug,
    subagents: sanitizedSubagents,
    tools: {
      mcpMode: form.mcpMode,
      native: resolvedNativeTools,
      toolProfileId: trimmedToolProfileId,
    },
    visibility: form.visibility,
  }

  if (!editingAgentId) return base
  return { ...base, revisionId: form.revisionId! }
}

const saveAgent = async (): Promise<boolean> => {
  if (isSaving) return false
  errorMessage = ''
  successMessage = ''
  const payload = buildPayload()
  if (!payload) return false

  isSaving = true
  try {
    const wasEditing = Boolean(editingAgentId)
    const saved = editingAgentId
      ? await updateAgent(editingAgentId, payload as UpdateAgentApiInput)
      : await createAgent(payload)

    editingAgentId = saved.id
    populateForm(saved)
    await tick()
    loadedFormSnapshot = formFingerprint
    void loadToolProfiles()

    hasStaleSubagentIds = false
    successMessage = `${wasEditing ? 'Updated' : 'Created'} "${form.name.trim()}".`
    return true
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not save this agent.',
    )
    return false
  } finally {
    isSaving = false
  }
}

let isConfirmingDelete = $state(false)
let deleteConfirmTimer: ReturnType<typeof setTimeout> | null = null

const removeAgent = async () => {
  if (!editingAgentId || deletingAgentId) return

  if (!isConfirmingDelete) {
    isConfirmingDelete = true
    deleteConfirmTimer = setTimeout(() => {
      isConfirmingDelete = false
    }, 3000)
    return
  }

  if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer)
  isConfirmingDelete = false
  deletingAgentId = editingAgentId
  try {
    await deleteAgent(editingAgentId)
    successMessage = `Deleted "${form.name}".`
    viewStore.pop()
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not delete.',
    )
  } finally {
    deletingAgentId = null
  }
}

const makeDefaultTarget = async () => {
  if (!editingAgentId || isSettingDefault || isDefaultForAccount) {
    return
  }

  isSettingDefault = true
  errorMessage = ''
  successMessage = ''

  try {
    await updateAccountPreferences({
      defaultTarget: {
        agentId: editingAgentId,
        kind: 'agent',
      },
    })
    isDefaultForAccount = true
    successMessage = `"${form.name.trim()}" is now the default chat target.`
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not update the default chat target.',
    )
  } finally {
    isSettingDefault = false
  }
}

const applyModelDefaults = () => {
  if (!modelsCatalog) return

  const defaultProvider = modelsCatalog.defaultProvider ?? 'openai'
  const defaultAlias = modelsCatalog.defaultAlias ?? 'default'
  const firstProviderAlias = modelsCatalog.aliases.find((a) => a.provider === defaultProvider)

  if (!form.modelAlias || form.modelAlias === 'default') {
    form.modelProvider = defaultProvider
    form.modelAlias = firstProviderAlias?.alias ?? defaultAlias
    form.reasoningEffort = pickReasoningSelection(firstProviderAlias ?? null, defaultProvider)
  }
}

const loadToolProfiles = async () => {
  isLoadingToolProfiles = true

  try {
    availableToolProfiles = await listToolProfiles()
  } catch {
    availableToolProfiles = []
  } finally {
    isLoadingToolProfiles = false
  }
}

const selectToolProfile = (toolProfileId: string) => {
  form.toolProfileId = toolProfileId
  if (toolProfileId) {
    void loadToolPreview(toolProfileId)
  } else {
    toolPreviewGroups = []
  }
}

const isActiveView = (): boolean => viewKey(viewStore.activeView) === viewKey(getFormView())

let isConfirmingDiscard = $state(false)
let discardTimer: ReturnType<typeof setTimeout> | null = null

const requestClose = (): void => {
  if (!formIsDirty) {
    viewStore.pop()
    return
  }
  if (!isConfirmingDiscard) {
    isConfirmingDiscard = true
    discardTimer = setTimeout(() => {
      isConfirmingDiscard = false
    }, 3000)
    return
  }
  if (discardTimer) clearTimeout(discardTimer)
  isConfirmingDiscard = false
  viewStore.pop()
}

const saveAndClose = async (): Promise<void> => {
  if (!formIsDirty) {
    viewStore.pop()
    return
  }

  if (await saveAgent()) {
    viewStore.pop()
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (!isActiveView()) {
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    void requestClose()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void saveAndClose()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    void saveAgent()
  }
}

const duplicateAgent = () => {
  if (!editingAgentId) return
  editingAgentId = null
  form.revisionId = null
  form.name = `${form.name} (copy)`
  form.slug = slugify(form.name)
  isDefaultForAccount = false
  loadedFormSnapshot = ''
  void tick().then(() => {
    scrollFormViewToTop(formRoot)
  })
}

onMount(() => {
  window.addEventListener('keydown', handleKeydown)
  void tick().then(() => {
    scrollFormViewToTop(formRoot)
  })

  isLoadingDetail = true

  void Promise.all([
    listAgents({ limit: 200 }).then((a) => {
      agents = a
    }),
    listGardens()
      .then((g) => {
        gardens = g
      })
      .catch(() => {
        gardens = []
      }),
    getSupportedModels()
      .then((c) => {
        modelsCatalog = c
      })
      .catch(() => {
        modelsCatalog = null
      }),
    loadToolProfiles(),
    getSystemRuntimeStatus()
      .then((status) => {
        runtimeStatus = status
      })
      .catch(() => {
        runtimeStatus = null
      }),
  ])
    .then(async () => {
      if (agentId) {
        try {
          const detail = await getAgent(agentId as AgentId)
          editingAgentId = agentId as AgentId
          populateForm(detail)
        } catch (error) {
          errorMessage = humanizeErrorMessage(
            error instanceof Error ? error.message : 'Could not load agent.',
          )
        }
      } else {
        form = createEmptyForm()
        applyModelDefaults()
        applySandboxRuntimeAvailabilityDefaults()
        isDefaultForAccount = false
      }
    })
    .finally(() => {
      isLoadingDetail = false
      void tick().then(() => {
        scrollFormViewToTop(formRoot)
        loadedFormSnapshot = formFingerprint
        sandboxAdvancedOpen = sandboxHasAdvancedValues
        browserAdvancedOpen = browserHasAdvancedValues
        // Register after snapshot is set so the guard reflects actual dirty state
        viewStore.registerDirtyGuard(getFormView(), () => formIsDirty)
      })
    })
})

onDestroy(() => {
  if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer)
  if (discardTimer) clearTimeout(discardTimer)
  window.removeEventListener('keydown', handleKeydown)
  viewStore.clearDirtyGuard(getFormView())
})
</script>

<div class="mx-auto w-full px-6 py-8" style="max-width: var(--chat-max-w, 42rem)" bind:this={formRoot}>
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <h2 class="text-[16px] font-semibold text-text-primary">
          {editingAgentId ? 'Edit Agent' : 'New Agent'}
        </h2>
        {#if editingAgentId && isDefaultForAccount}
          <span class="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-text">default</span>
        {/if}
      </div>
      <p class="mt-1 text-[13px] text-text-secondary">
        An agent defines how the AI responds — its instructions, model, and tool access.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <ActionButton variant={isConfirmingDiscard ? 'danger' : 'secondary'} onclick={() => { requestClose() }}>
        {isConfirmingDiscard ? 'Discard' : viewStore.backLabel ?? 'Back to Chat'}
      </ActionButton>
      <ActionButton variant="primary" disabled={isSaving} onclick={() => { void saveAndClose() }}>
        {isSaving ? 'Saving…' : 'Save & Close'}
      </ActionButton>
    </div>
  </div>

  {#if errorMessage}
    <AlertBanner variant="error" message={errorMessage} ondismiss={() => { errorMessage = '' }} />
  {/if}
  {#if successMessage}
    <AlertBanner variant="success" message={successMessage} ondismiss={() => { successMessage = '' }} />
  {/if}

  {#if isLoadingDetail}
    <div class="rounded-lg border border-border bg-surface-1/60 px-4 py-5 text-[13px] text-text-secondary">Loading agent…</div>
  {:else}
    <form class="space-y-6" onsubmit={(e) => { e.preventDefault(); void saveAgent() }}>
      <!-- Name -->
      <FieldInput label="Name" value={form.name} placeholder="My Agent" maxlength={200} error={fieldErrors.name}
        oninput={(v) => { form.name = v; form.slug = slugify(v); delete fieldErrors.name }} />

      <label class="block">
        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Description
        </span>
        <textarea
          class="min-h-[84px] w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
          placeholder="Short summary shown to other agents when they decide whether to delegate work here."
          maxlength={500}
          value={form.description}
          oninput={(e) => {
            form.description = e.currentTarget.value
          }}
        ></textarea>
        <span class="mt-2 block text-[11px] text-text-tertiary">
          Keep this short and concrete. It is used as delegation metadata, not as the main instruction prompt.
        </span>
      </label>

      <!-- Instructions (moved up — most frequently edited) -->
      <div>
        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Instructions</span>
        <div class="sd-agent-instructions">
          {#key editingAgentId ?? '__new__'}
            <TiptapPromptEditor
              bind:this={instructionsEditor}
              value={form.instructionsMd}
              placeholder="Enter instructions for this agent…"
              ariaLabel="Agent instructions"
              onMarkdownChange={(markdown) => { form.instructionsMd = markdown; delete fieldErrors.instructionsMd }}
            />
          {/key}
        </div>
        {#if fieldErrors.instructionsMd}
          <span class="mt-1 block text-[11px] text-danger-text">{fieldErrors.instructionsMd}</span>
        {/if}
      </div>

      <!-- Model Configuration -->
      <SectionCard title="Model" collapsible defaultOpen>
        <div class="space-y-5">
          <div class="max-w-xs">
            <span class="mb-2 block text-[12px] font-medium text-text-secondary">Provider</span>
            <SegmentControl
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'google', label: 'Google' },
                { value: 'openrouter', label: 'OpenRouter' },
              ]}
              value={form.modelProvider}
              onchange={(v) => {
                form.modelProvider = v as ProviderName
                const firstAlias = modelsCatalog?.aliases.find((a) => a.provider === v)
                if (firstAlias) selectAlias(firstAlias)
              }}
            />
          </div>
          <div>
            <span class="mb-2 block text-[12px] font-medium text-text-secondary">Model</span>
            {#if !modelsCatalog}
              <p class="text-[12px] text-text-tertiary">Loading models…</p>
            {:else if providerAliases.length === 0}
              <p class="text-[12px] text-text-tertiary">No models available for this provider.</p>
            {:else}
              <div class="space-y-1">
                {#each providerAliases as alias}
                  {@const isActive = form.modelAlias === alias.alias}
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {isActive ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
                    onclick={() => selectAlias(alias)}
                  >
                    <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition-colors {isActive ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
                      {#if isActive}
                        <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
                      {/if}
                    </span>
                    <span class="min-w-18 shrink-0 font-medium {isActive ? 'text-text-primary' : 'text-text-secondary'}">{alias.alias}</span>
                    <span class="flex-1 truncate text-[12px] {isActive ? 'text-accent-text' : 'text-text-tertiary'}">{alias.model}</span>
                  </button>
                {/each}
              </div>
            {/if}
            {#if fieldErrors.modelAlias}
              <span class="mt-1 block text-[11px] text-danger-text">{fieldErrors.modelAlias}</span>
            {/if}
          </div>
          <div>
            <span class="mb-2 block text-[12px] font-medium text-text-secondary">{reasoningLabel}</span>
            {#if !selectedAliasEntry}
              <p class="text-[12px] text-text-tertiary">Select a model first.</p>
            {:else if !selectedAliasEntry.supportsReasoning}
              <p class="text-[12px] text-text-tertiary">
                {selectedAliasEntry.model} does not support reasoning.
              </p>
            {:else if availableReasoningModes.length === 0}
              <p class="text-[12px] text-text-tertiary">
                No reasoning modes reported for {selectedAliasEntry.model}.
              </p>
            {:else}
              <div class="space-y-1">
                {#each availableReasoningModes as mode}
                  {@const isActive = form.reasoningEffort === mode}
                  {@const desc = getModeDescription(mode)}
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {isActive ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
                    onclick={() => { form.reasoningEffort = mode }}
                  >
                    <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition-colors {isActive ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
                      {#if isActive}
                        <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
                      {/if}
                    </span>
                    <span class="min-w-18 shrink-0 font-medium {isActive ? 'text-text-primary' : 'text-text-secondary'}">{getModeLabel(mode)}</span>
                    <span class="flex-1 truncate text-[12px] {isActive ? 'text-accent-text' : 'text-text-tertiary'}">{desc}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </SectionCard>

      <!-- Capabilities -->
      <SectionCard title="Capabilities" description="What this agent can do natively." collapsible defaultOpen>
        <div class="space-y-1">
          {#each TOOL_OPTIONS as tool}
            {@const enabled = form.nativeTools.includes(tool.id)}
            {@const unavailable = Boolean(tool.requiresImageProvider && !imageGenerationConfigured)}
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {unavailable ? 'cursor-not-allowed border-border bg-surface-0 opacity-60' : enabled ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0'}"
              disabled={unavailable}
              onclick={() => {
                if (unavailable) return
                form.nativeTools = enabled
                  ? form.nativeTools.filter((t) => t !== tool.id)
                  : [...form.nativeTools, tool.id]
              }}
            >
              <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {enabled ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent'}">
                <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-[12px] font-medium {enabled ? 'text-text-primary' : 'text-text-tertiary'}">{tool.label}</span>
                <span class="block text-[11px] {enabled ? 'text-text-secondary' : 'text-text-tertiary'}">
                  {unavailable
                    ? `${tool.description} · requires image provider configuration`
                    : tool.description}
                </span>
              </span>
            </button>
          {/each}
        </div>
      </SectionCard>

      <!-- MCP Tools -->
      <SectionCard title="MCP Tools" description="External tools from connected servers." collapsible defaultOpen={Boolean(form.toolProfileId)}>
        <div class="space-y-5">
          <div>
            <div class="mb-2 flex items-center justify-between gap-3">
              <span class="text-[12px] font-medium text-text-secondary">Tool profile</span>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="text-[11px] text-text-tertiary transition-colors hover:text-text-secondary"
                  onclick={() => {
                    void loadToolProfiles()
                  }}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  class="text-[11px] text-text-tertiary transition-colors hover:text-text-secondary"
                  onclick={() => {
                    if (form.toolProfileId) {
                      viewStore.push({
                        kind: 'tool-profile-form',
                        toolProfileId: form.toolProfileId,
                      })
                      return
                    }

                    viewStore.push({ kind: 'tool-profile-form' })
                  }}
                >
                  {form.toolProfileId ? 'Edit profile' : 'Create profile'}
                </button>
              </div>
            </div>

            {#if isLoadingToolProfiles}
              <p class="py-3 text-center text-[12px] text-text-tertiary">Loading tool profiles…</p>
            {:else if availableToolProfiles.length === 0}
              <p class="rounded-md border border-dashed border-border py-3 text-center text-[12px] text-text-tertiary">
                No tool profiles available yet. Create one to grant MCP tool access.
              </p>
            {:else}
              <div class="space-y-1">
                <button
                  type="button"
                  class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {!form.toolProfileId ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
                  onclick={() => {
                    selectToolProfile('')
                  }}
                >
                  <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition-colors {!form.toolProfileId ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
                    {#if !form.toolProfileId}
                      <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
                    {/if}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block font-medium text-text-primary">None</span>
                    <span class="block text-[11px] text-text-tertiary">
                      Use only native capabilities.
                    </span>
                  </span>
                </button>

                {#each availableToolProfiles as profile}
                  {@const isSelected = form.toolProfileId === profile.id}
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {isSelected ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
                    onclick={() => {
                      selectToolProfile(profile.id)
                    }}
                  >
                    <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition-colors {isSelected ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
                      {#if isSelected}
                        <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
                      {/if}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-medium text-text-primary">{profile.name}</span>
                      <span class="block text-[11px] text-text-tertiary">
                        {profile.scope === 'tenant_shared' ? 'Shared' : 'Private'}
                        {profile.status === 'archived' ? ' · archived' : ''}
                        {#if isSelected && !isLoadingToolPreview && toolPreviewGroups.length > 0}
                          · {toolPreviewSummary}
                        {/if}
                      </span>
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          {#if form.toolProfileId}
            <div>
              <span class="mb-2 block text-[12px] font-medium text-text-secondary">Execution mode</span>
              <SegmentControl
                options={[
                  {
                    value: 'direct',
                    label: 'Direct',
                    description: 'Call MCP tools directly',
                  },
                  {
                    value: 'code',
                    label: 'Code',
                    description: 'Use sandboxed code to call MCP tools',
                  },
                ]}
                value={form.mcpMode}
                onchange={(value) => {
                  form.mcpMode = value as AgentMcpMode
                  delete fieldErrors.mcpMode
                }}
              />
              {#if form.mcpMode === 'code'}
                <p class="mt-2 text-[11px] text-text-tertiary">
                  Code mode uses the sandbox engine from this agent's sandbox policy. Enable sandbox below to use code mode.
                </p>
              {/if}
              {#if fieldErrors.mcpMode}
                <span class="mt-1 block text-[11px] text-danger-text">{fieldErrors.mcpMode}</span>
              {/if}
            </div>
          {/if}
        </div>
      </SectionCard>

      <SectionCard
        title="Sandbox"
        description="Run code in an isolated environment. File changes require approval."
        collapsible
        defaultOpen={form.sandbox.enabled}
      >
        <div class="space-y-5">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {form.sandbox.enabled ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
            onclick={() => {
              form.sandbox.enabled = !form.sandbox.enabled
            }}
          >
            <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded border transition-colors {form.sandbox.enabled ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
              {#if form.sandbox.enabled}
                <svg class="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-text-primary">Enable sandbox</span>
              <span class="block text-[11px] text-text-tertiary">
                Allow this agent to run code in an isolated environment.
              </span>
            </span>
          </button>

          {#if form.sandbox.enabled}
            <div class="space-y-5 border-t border-border pt-4">
              {#if sandboxRuntimeNotice}
                <div
                  class="rounded-md border px-3 py-2 text-[12px] {sandboxRuntimeNotice.tone === 'ready'
                    ? 'border-success/30 bg-success/10 text-success-text'
                    : 'border-warning/30 bg-warning/10 text-warning-text'}"
                >
                  {sandboxRuntimeNotice.text}
                </div>
              {/if}

              <!-- Essential: Engine -->
              <div class="space-y-3">
                <div>
                  <span class="mb-2 block text-[12px] font-medium text-text-secondary">Default engine</span>
                  <SegmentControl
                    options={SANDBOX_ENGINE_OPTIONS}
                    value={form.sandbox.runtimeDefaultEngine}
                    onchange={setSandboxDefaultEngine}
                  />
                  <span class="mt-2 block text-[11px] text-text-tertiary">{sandboxEngineHelpText}</span>
                  {#if fieldErrors['sandbox.runtime.defaultEngine']}
                    <span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['sandbox.runtime.defaultEngine']}</span>
                  {/if}
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => toggleSandboxAllowedEngine('lo')}>
                    <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.sandbox.runtimeAllowedLo ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}">
                      <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                    </span>
                    <span class="text-[13px] text-text-secondary">Allow lo preferred runtime</span>
                  </button>
                  <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => toggleSandboxAllowedEngine('node')}>
                    <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.sandbox.runtimeAllowedNode ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}">
                      <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                    </span>
                    <span class="text-[13px] text-text-secondary">Allow Node.js fallback</span>
                  </button>
                </div>
                {#if fieldErrors['sandbox.runtime.allowedEngines']}
                  <span class="block text-[11px] text-danger-text">{fieldErrors['sandbox.runtime.allowedEngines']}</span>
                {/if}
                <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.sandbox.runtimeAllowAutomaticCompatFallback = !form.sandbox.runtimeAllowAutomaticCompatFallback; delete fieldErrors['sandbox.runtime.allowAutomaticCompatFallback'] }}>
                  <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.sandbox.runtimeAllowAutomaticCompatFallback ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}">
                    <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                  </span>
                  <span class="text-[13px] text-text-secondary">Auto-fallback from lo to Node.js for incompatible requests</span>
                </button>
                {#if fieldErrors['sandbox.runtime.allowAutomaticCompatFallback']}
                  <span class="block text-[11px] text-danger-text">{fieldErrors['sandbox.runtime.allowAutomaticCompatFallback']}</span>
                {/if}
              </div>

              <!-- Essential: Network -->
              <div class="space-y-3">
                <div>
                  <span class="mb-2 block text-[12px] font-medium text-text-secondary">Network access</span>
                  <SegmentControl
                    options={SANDBOX_NETWORK_OPTIONS}
                    value={form.sandbox.networkMode}
                    onchange={(value: AgentSandboxNetworkMode) => {
                      form.sandbox.networkMode = value
                    }}
                  />
                </div>
                {#if form.sandbox.networkMode === 'allow_list'}
                  <label class="block">
                    <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
                      Allowed hosts
                    </span>
                    <textarea
                      class="min-h-[92px] w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
                      placeholder="registry.npmjs.org&#10;npm.pkg.github.com"
                      value={form.sandbox.networkAllowedHostsText}
                      oninput={(event) => {
                        form.sandbox.networkAllowedHostsText = event.currentTarget.value
                        delete fieldErrors['sandbox.network.allowedHosts']
                      }}
                    ></textarea>
                    <span class="mt-2 block text-[11px] text-text-tertiary">One host per line.</span>
                    {#if fieldErrors['sandbox.network.allowedHosts']}
                      <span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['sandbox.network.allowedHosts']}</span>
                    {/if}
                  </label>
                {/if}
              </div>

              <!-- Essential: Vault access + approvals right below -->
              <div class="space-y-3">
                <div>
                  <span class="mb-2 block text-[12px] font-medium text-text-secondary">Vault access</span>
                  <SegmentControl
                    options={SANDBOX_VAULT_OPTIONS}
                    value={form.sandbox.vaultMode}
                    onchange={(value: AgentSandboxVaultMode) => {
                      form.sandbox.vaultMode = value
                    }}
                  />
                </div>
                {#if form.sandbox.vaultMode === 'read_write'}
                  <div class="grid gap-3 sm:grid-cols-2">
                    <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.sandbox.requireApprovalForWrite = !form.sandbox.requireApprovalForWrite }}>
                      <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.sandbox.requireApprovalForWrite ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}">
                        <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                      </span>
                      <span class="text-[13px] text-text-secondary">Approve writes</span>
                    </button>
                    <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.sandbox.requireApprovalForMove = !form.sandbox.requireApprovalForMove }}>
                      <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.sandbox.requireApprovalForMove ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}">
                        <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                      </span>
                      <span class="text-[13px] text-text-secondary">Approve moves</span>
                    </button>
                    <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.sandbox.requireApprovalForDelete = !form.sandbox.requireApprovalForDelete }}>
                      <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.sandbox.requireApprovalForDelete ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}">
                        <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                      </span>
                      <span class="text-[13px] text-text-secondary">Approve deletes</span>
                    </button>
                    <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.sandbox.requireApprovalForWorkspaceScript = !form.sandbox.requireApprovalForWorkspaceScript }}>
                      <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.sandbox.requireApprovalForWorkspaceScript ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}">
                        <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                      </span>
                      <span class="text-[13px] text-text-secondary">Approve workspace scripts</span>
                    </button>
                  </div>
                {/if}
                {#if form.sandbox.vaultMode !== 'none'}
                  <label class="block">
                    <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Allowed vault roots</span>
                    <textarea
                      class="min-h-[68px] w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
                      placeholder="/vault&#10;/vault/projects"
                      value={form.sandbox.vaultAllowedRootsText}
                      oninput={(event) => { form.sandbox.vaultAllowedRootsText = event.currentTarget.value; delete fieldErrors['sandbox.vault.allowedRoots'] }}
                    ></textarea>
                    <span class="mt-2 block text-[11px] text-text-tertiary">One path per line. Leave empty to allow all reachable paths.</span>
                    {#if fieldErrors['sandbox.vault.allowedRoots']}
                      <span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['sandbox.vault.allowedRoots']}</span>
                    {/if}
                  </label>
                {/if}
              </div>

              <!-- Advanced toggle -->
              <button
                type="button"
                class="flex w-full items-center gap-2 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
                onclick={() => { sandboxAdvancedOpen = !sandboxAdvancedOpen }}
              >
                <svg class="h-3 w-3 transition-transform {sandboxAdvancedOpen ? 'rotate-90' : ''}" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 2 8 6 4 10" /></svg>
                Advanced settings
              </button>

              {#if sandboxAdvancedOpen}
                <div class="space-y-5 border-t border-border pt-4">
                  <!-- Packages -->
                  <div class="space-y-3">
                    <div>
                      <span class="mb-2 block text-[12px] font-medium text-text-secondary">Packages</span>
                      <SegmentControl
                        options={SANDBOX_PACKAGE_OPTIONS}
                        value={form.sandbox.packageMode}
                        onchange={(value: AgentSandboxPackageMode) => { form.sandbox.packageMode = value; delete fieldErrors['sandbox.packages.mode']; delete fieldErrors['sandbox.packages.allowedPackages'] }}
                      />
                      <span class="mt-2 block text-[11px] text-text-tertiary">Packages currently execute on Node.js only. lo package-backed execution is not implemented yet.</span>
                      {#if fieldErrors['sandbox.packages.mode']}
                        <span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['sandbox.packages.mode']}</span>
                      {/if}
                    </div>
                    {#if form.sandbox.packageMode !== 'disabled' && sandboxPackageWarnings.length > 0}
                      <div class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning-text">
                        {#each sandboxPackageWarnings as warning}
                          <div>{warning}</div>
                        {/each}
                      </div>
                    {/if}
                    {#if form.sandbox.packageMode !== 'disabled'}
                      <label class="block">
                        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Allowed registries</span>
                        <textarea
                          class="min-h-[68px] w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
                          placeholder="registry.npmjs.org"
                          value={form.sandbox.packageAllowedRegistriesText}
                          oninput={(event) => { form.sandbox.packageAllowedRegistriesText = event.currentTarget.value }}
                        ></textarea>
                        <span class="mt-2 block text-[11px] text-text-tertiary">One host per line. Optional.</span>
                      </label>
                    {/if}
                    {#if form.sandbox.packageMode === 'allow_list'}
                      <div class="space-y-3 rounded-md border border-border bg-surface-0 p-3">
                        <div class="flex items-center justify-between gap-3">
                          <span class="text-[12px] font-medium text-text-secondary">Allowed packages</span>
                          <button type="button" class="rounded-md border border-border bg-surface-1 px-2.5 py-1 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary" onclick={() => { form.sandbox.packageAllowedPackages = [...form.sandbox.packageAllowedPackages, createEmptySandboxPackage()] }}>
                            Add
                          </button>
                        </div>
                        {#if form.sandbox.packageAllowedPackages.length === 0}
                          <p class="text-[12px] text-text-tertiary">No packages allowlisted yet.</p>
                        {:else}
                          <div class="space-y-2">
                            {#each form.sandbox.packageAllowedPackages as entry, index}
                              <div class="rounded-md border border-border bg-surface-1 p-3">
                                <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                  <label class="block">
                                    <span class="mb-2 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Package</span>
                                    <input class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" placeholder="sharp" value={entry.name} oninput={(event) => { form.sandbox.packageAllowedPackages[index].name = event.currentTarget.value; delete fieldErrors['sandbox.packages.allowedPackages'] }} />
                                  </label>
                                  <label class="block">
                                    <span class="mb-2 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Version</span>
                                    <input class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" placeholder="0.33.5" value={entry.versionRange} oninput={(event) => { form.sandbox.packageAllowedPackages[index].versionRange = event.currentTarget.value; delete fieldErrors['sandbox.packages.allowedPackages'] }} />
                                  </label>
                                  <div class="flex items-end justify-end">
                                    <button type="button" class="rounded-md border border-border bg-surface-0 px-2.5 py-2 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary" onclick={() => { form.sandbox.packageAllowedPackages = form.sandbox.packageAllowedPackages.filter((_, rowIndex) => rowIndex !== index); delete fieldErrors['sandbox.packages.allowedPackages'] }}>Remove</button>
                                  </div>
                                </div>
                                <div class="mt-3 flex flex-wrap items-center gap-4">
                                  <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.sandbox.packageAllowedPackages[index].allowLo = !form.sandbox.packageAllowedPackages[index].allowLo; delete fieldErrors['sandbox.packages.allowedPackages'] }}>
                                    <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {entry.allowLo ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}"><svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg></span>
                                    <span class="text-[12px] text-text-secondary">lo (not supported yet)</span>
                                  </button>
                                  <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.sandbox.packageAllowedPackages[index].allowNode = !form.sandbox.packageAllowedPackages[index].allowNode; delete fieldErrors['sandbox.packages.allowedPackages'] }}>
                                    <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {entry.allowNode ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}"><svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg></span>
                                    <span class="text-[12px] text-text-secondary">Node.js</span>
                                  </button>
                                  <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.sandbox.packageAllowedPackages[index].allowInstallScripts = !form.sandbox.packageAllowedPackages[index].allowInstallScripts; delete fieldErrors['sandbox.packages.allowedPackages'] }}>
                                    <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {entry.allowInstallScripts ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}"><svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg></span>
                                    <span class="text-[12px] text-text-secondary">Install scripts</span>
                                  </button>
                                </div>
                              </div>
                            {/each}
                          </div>
                        {/if}
                        {#if fieldErrors['sandbox.packages.allowedPackages']}
                          <span class="block text-[11px] text-danger-text">{fieldErrors['sandbox.packages.allowedPackages']}</span>
                        {/if}
                      </div>
                    {/if}
                  </div>

                  <!-- Runtime limits -->
                  <div class="space-y-3">
                    <span class="block text-[12px] font-medium text-text-secondary">Runtime limits</span>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.sandbox.runtimeAllowWorkspaceScripts = !form.sandbox.runtimeAllowWorkspaceScripts }}>
                        <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.sandbox.runtimeAllowWorkspaceScripts ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}">
                          <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                        </span>
                        <span class="text-[13px] text-text-secondary">Allow workspace scripts</span>
                      </button>
                      {#if form.sandbox.runtimeAllowedNode}
                        <label class="block">
                          <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Node.js version</span>
                          <input class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" placeholder="22" value={form.sandbox.runtimeNodeVersion} oninput={(event) => { form.sandbox.runtimeNodeVersion = event.currentTarget.value }} />
                          <span class="mt-2 block text-[11px] text-text-tertiary">Used only for Node.js jobs.</span>
                        </label>
                      {/if}
                      <label class="block">
                        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Max duration (sec)</span>
                        <input class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" inputmode="numeric" value={form.sandbox.runtimeMaxDurationSec} oninput={(event) => { form.sandbox.runtimeMaxDurationSec = event.currentTarget.value; delete fieldErrors['sandbox.runtime.maxDurationSec'] }} />
                        {#if fieldErrors['sandbox.runtime.maxDurationSec']}<span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['sandbox.runtime.maxDurationSec']}</span>{/if}
                      </label>
                      <label class="block">
                        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Max memory (MB)</span>
                        <input class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" inputmode="numeric" value={form.sandbox.runtimeMaxMemoryMb} oninput={(event) => { form.sandbox.runtimeMaxMemoryMb = event.currentTarget.value; delete fieldErrors['sandbox.runtime.maxMemoryMb'] }} />
                        <span class="mt-2 block text-[11px] text-text-tertiary">Currently enforced by Node.js only.</span>
                        {#if fieldErrors['sandbox.runtime.maxMemoryMb']}<span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['sandbox.runtime.maxMemoryMb']}</span>{/if}
                      </label>
                      <label class="block">
                        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Max input bytes</span>
                        <input class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" inputmode="numeric" value={form.sandbox.runtimeMaxInputBytes} oninput={(event) => { form.sandbox.runtimeMaxInputBytes = event.currentTarget.value; delete fieldErrors['sandbox.runtime.maxInputBytes'] }} />
                        <span class="mt-2 block text-[11px] text-text-tertiary">Stored in policy, but not currently enforced by the active runtimes.</span>
                        {#if fieldErrors['sandbox.runtime.maxInputBytes']}<span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['sandbox.runtime.maxInputBytes']}</span>{/if}
                      </label>
                      <label class="block">
                        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Max output bytes</span>
                        <input class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" inputmode="numeric" value={form.sandbox.runtimeMaxOutputBytes} oninput={(event) => { form.sandbox.runtimeMaxOutputBytes = event.currentTarget.value; delete fieldErrors['sandbox.runtime.maxOutputBytes'] }} />
                        {#if fieldErrors['sandbox.runtime.maxOutputBytes']}<span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['sandbox.runtime.maxOutputBytes']}</span>{/if}
                      </label>
                    </div>
                  </div>

                  <!-- Shell commands -->
                  <label class="block">
                    <span class="mb-2 block text-[12px] font-medium text-text-secondary">Shell command allow list</span>
                    <textarea
                      class="min-h-[68px] w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
                      placeholder="find&#10;grep&#10;ls&#10;cat"
                      value={form.sandbox.shellAllowedCommandsText}
                      oninput={(event) => { form.sandbox.shellAllowedCommandsText = event.currentTarget.value; delete fieldErrors['sandbox.shell.allowedCommands'] }}
                    ></textarea>
                    <span class="mt-2 block text-[11px] text-text-tertiary">{sandboxShellAllowListHelpText}</span>
                    {#if fieldErrors['sandbox.shell.allowedCommands']}
                      <span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['sandbox.shell.allowedCommands']}</span>
                    {/if}
                  </label>
                </div>
              {/if}
            </div>
          {:else}
            <p class="text-[12px] text-text-tertiary">
              When enabled, the agent can run scripts and shell commands in a secure sandbox.
            </p>
          {/if}
        </div>
      </SectionCard>

      <SectionCard
        title="Browser"
        description="Automate web browsers — navigate, screenshot, and extract content."
        collapsible
        defaultOpen={form.kernel.enabled}
      >
        <div class="space-y-5">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {form.kernel.enabled ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
            onclick={() => {
              form.kernel.enabled = !form.kernel.enabled
            }}
          >
            <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded border transition-colors {form.kernel.enabled ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
              {#if form.kernel.enabled}
                <svg class="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-text-primary">Enable browser automation</span>
              <span class="block text-[11px] text-text-tertiary">
                Allow this agent to control a web browser.
              </span>
            </span>
          </button>

          {#if form.kernel.enabled}
            <div class="space-y-5 border-t border-border pt-4">
              {#if kernelRuntimeNotice}
                <div
                  class="rounded-md border px-3 py-2 text-[12px] {kernelRuntimeNotice.tone === 'ready'
                    ? 'border-accent/20 bg-accent/5 text-accent-text'
                    : kernelRuntimeNotice.tone === 'warning'
                      ? 'border-danger/20 bg-danger/5 text-danger-text'
                      : 'border-border bg-surface-0 text-text-tertiary'}"
                >
                  {kernelRuntimeNotice.text}
                </div>
              {/if}

              <!-- Essential: Network -->
              <div class="space-y-3">
                <div>
                  <span class="mb-2 block text-[12px] font-medium text-text-secondary">Network access</span>
                  <SegmentControl
                    options={KERNEL_NETWORK_OPTIONS}
                    value={form.kernel.networkMode}
                    onchange={(value: AgentKernelNetworkMode) => {
                      form.kernel.networkMode = value
                    }}
                  />
                </div>
                {#if form.kernel.networkMode === 'allow_list'}
                  <label class="block">
                    <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Allowed hosts</span>
                    <textarea
                      class="min-h-[68px] w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
                      placeholder="example.com&#10;news.ycombinator.com"
                      value={form.kernel.networkAllowedHostsText}
                      oninput={(event) => { form.kernel.networkAllowedHostsText = event.currentTarget.value }}
                    ></textarea>
                    <span class="mt-2 block text-[11px] text-text-tertiary">One host per line.</span>
                  </label>
                {/if}
                {#if form.kernel.networkMode !== 'off'}
                  <label class="block">
                    <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Blocked hosts</span>
                    <textarea
                      class="min-h-[68px] w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
                      placeholder="accounts.google.com"
                      value={form.kernel.networkBlockedHostsText}
                      oninput={(event) => { form.kernel.networkBlockedHostsText = event.currentTarget.value }}
                    ></textarea>
                    <span class="mt-2 block text-[11px] text-text-tertiary">Optional deny-list. One host per line.</span>
                  </label>
                {/if}
              </div>

              <!-- Advanced toggle -->
              <button
                type="button"
                class="flex w-full items-center gap-2 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
                onclick={() => { browserAdvancedOpen = !browserAdvancedOpen }}
              >
                <svg class="h-3 w-3 transition-transform {browserAdvancedOpen ? 'rotate-90' : ''}" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 2 8 6 4 10" /></svg>
                Advanced settings
              </button>

              {#if browserAdvancedOpen}
                <div class="space-y-5 border-t border-border pt-4">
                  <!-- Runtime limits -->
                  <div class="space-y-3">
                    <span class="block text-[12px] font-medium text-text-secondary">Runtime</span>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <label class="block">
                        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Max duration (sec)</span>
                        <input class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" inputmode="numeric" value={form.kernel.browserMaxDurationSec} oninput={(event) => { form.kernel.browserMaxDurationSec = event.currentTarget.value; delete fieldErrors['kernel.browser.maxDurationSec'] }} />
                        {#if fieldErrors['kernel.browser.maxDurationSec']}<span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['kernel.browser.maxDurationSec']}</span>{/if}
                      </label>
                      <label class="block">
                        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Max concurrent sessions</span>
                        <input class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" inputmode="numeric" value={form.kernel.browserMaxConcurrentSessions} oninput={(event) => { form.kernel.browserMaxConcurrentSessions = event.currentTarget.value; delete fieldErrors['kernel.browser.maxConcurrentSessions'] }} />
                        {#if fieldErrors['kernel.browser.maxConcurrentSessions']}<span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['kernel.browser.maxConcurrentSessions']}</span>{/if}
                      </label>
                      <label class="block">
                        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Viewport width</span>
                        <input class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" inputmode="numeric" value={form.kernel.browserDefaultViewportWidth} oninput={(event) => { form.kernel.browserDefaultViewportWidth = event.currentTarget.value; delete fieldErrors['kernel.browser.defaultViewport.width'] }} />
                        {#if fieldErrors['kernel.browser.defaultViewport.width']}<span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['kernel.browser.defaultViewport.width']}</span>{/if}
                      </label>
                      <label class="block">
                        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Viewport height</span>
                        <input class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" inputmode="numeric" value={form.kernel.browserDefaultViewportHeight} oninput={(event) => { form.kernel.browserDefaultViewportHeight = event.currentTarget.value; delete fieldErrors['kernel.browser.defaultViewport.height'] }} />
                        {#if fieldErrors['kernel.browser.defaultViewport.height']}<span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['kernel.browser.defaultViewport.height']}</span>{/if}
                      </label>
                    </div>
                    <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.kernel.browserAllowRecording = !form.kernel.browserAllowRecording }}>
                      <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.kernel.browserAllowRecording ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}">
                        <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                      </span>
                      <span class="text-[13px] text-text-secondary">Allow session recording</span>
                    </button>
                  </div>

                  <!-- Allowed outputs -->
                  <div class="space-y-3">
                    <span class="block text-[12px] font-medium text-text-secondary">Allowed outputs</span>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.kernel.outputsAllowScreenshot = !form.kernel.outputsAllowScreenshot }}>
                        <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.kernel.outputsAllowScreenshot ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}"><svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg></span>
                        <span class="text-[13px] text-text-secondary">Screenshots</span>
                      </button>
                      <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.kernel.outputsAllowHtml = !form.kernel.outputsAllowHtml }}>
                        <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.kernel.outputsAllowHtml ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}"><svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg></span>
                        <span class="text-[13px] text-text-secondary">HTML capture</span>
                      </button>
                      <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.kernel.outputsAllowPdf = !form.kernel.outputsAllowPdf }}>
                        <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.kernel.outputsAllowPdf ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}"><svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg></span>
                        <span class="text-[13px] text-text-secondary">PDF export</span>
                      </button>
                      <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.kernel.outputsAllowCookies = !form.kernel.outputsAllowCookies }}>
                        <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.kernel.outputsAllowCookies ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}"><svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg></span>
                        <span class="text-[13px] text-text-secondary">Cookies</span>
                      </button>
                      <button type="button" class="flex items-center gap-2 cursor-pointer" onclick={() => { form.kernel.outputsAllowRecording = !form.kernel.outputsAllowRecording }}>
                        <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.kernel.outputsAllowRecording ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}"><svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg></span>
                        <span class="text-[13px] text-text-secondary">Recording</span>
                      </button>
                      <label class="block sm:col-span-2">
                        <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Max output bytes</span>
                        <input class="w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong" inputmode="numeric" value={form.kernel.outputsMaxOutputBytes} oninput={(event) => { form.kernel.outputsMaxOutputBytes = event.currentTarget.value; delete fieldErrors['kernel.outputs.maxOutputBytes'] }} />
                        {#if fieldErrors['kernel.outputs.maxOutputBytes']}<span class="mt-1 block text-[11px] text-danger-text">{fieldErrors['kernel.outputs.maxOutputBytes']}</span>{/if}
                      </label>
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          {:else}
            <div class="space-y-3">
              {#if kernelRuntimeNotice}
                <div
                  class="rounded-md border px-3 py-2 text-[12px] {kernelRuntimeNotice.tone === 'ready'
                    ? 'border-accent/20 bg-accent/5 text-accent-text'
                    : kernelRuntimeNotice.tone === 'warning'
                      ? 'border-danger/20 bg-danger/5 text-danger-text'
                      : 'border-border bg-surface-0 text-text-tertiary'}"
                >
                  {kernelRuntimeNotice.text}
                </div>
              {/if}

              <p class="text-[12px] text-text-tertiary">
                When enabled, the agent can navigate websites, take screenshots, and extract content.
              </p>
            </div>
          {/if}
        </div>
      </SectionCard>

      <SectionCard
        title="Garden Focus"
        description="Prioritize specific gardens when this agent works with content."
        collapsible
        defaultOpen={form.preferredGardenSlugs.length > 0}
      >
        {#if availableGardens.length === 0}
          <p class="text-[12px] text-text-tertiary">
            No gardens available yet. If this agent can access workspace files, it may still discover Garden sources later.
          </p>
        {:else}
          <div class="mb-3 rounded-md border border-border bg-surface-0 px-3 py-2">
            <p class="text-[11px] text-text-tertiary">
              Select gardens to prioritize in prompt context and future Garden-native tools.
              This is guidance only. The agent can still discover other files and Garden sources in the same workspace.
            </p>
          </div>

          <div class="space-y-2">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {form.preferredGardenSlugs.length === 0 ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
              onclick={() => {
                form.preferredGardenSlugs = []
              }}
            >
              <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition-colors {form.preferredGardenSlugs.length === 0 ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
                {#if form.preferredGardenSlugs.length === 0}
                  <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
                {/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block font-medium text-text-primary">All reachable gardens</span>
                <span class="block text-[11px] text-text-tertiary">
                  Do not prioritize any specific garden.
                </span>
              </span>
            </button>

            {#each availableGardens as garden}
              {@const isSelected = form.preferredGardenSlugs.includes(garden.slug)}
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {isSelected ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
                onclick={() => {
                  form.preferredGardenSlugs = isSelected
                    ? form.preferredGardenSlugs.filter((slug) => slug !== garden.slug)
                    : normalizePreferredGardenSlugs([...form.preferredGardenSlugs, garden.slug])
                }}
              >
                <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded border transition-colors {isSelected ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
                  {#if isSelected}
                    <svg class="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  {/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium text-text-primary">
                    {garden.name}
                    {#if garden.isDefault}
                      <span class="ml-1 text-[10px] uppercase tracking-[0.06em] text-text-tertiary">default</span>
                    {/if}
                  </span>
                  <span class="block truncate text-[11px] text-text-tertiary">
                    /{garden.sourceScopePath === '.' ? 'vault' : `vault/${garden.sourceScopePath}`} · {garden.slug} · {garden.status}
                  </span>
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </SectionCard>

      <!-- Category + Visibility -->
      <SectionCard title="Category & Visibility" collapsible defaultOpen={false} description="How this agent is classified and who can see it.">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <SegmentControl
              options={[{ value: 'primary', label: 'Primary' }, { value: 'specialist', label: 'Specialist' }, { value: 'derived', label: 'Derived' }]}
              value={form.kind}
              onchange={(v) => { form.kind = v }}
            />
          </div>
          <div>
            <SegmentControl
              options={[{ value: 'account_private', label: 'Private' }, { value: 'tenant_shared', label: 'Shared' }]}
              value={form.visibility}
              onchange={(v) => { form.visibility = v }}
            />
          </div>
        </div>
      </SectionCard>

      <!-- Subagents -->
      <SectionCard title="Subagents" description="Other agents this one can delegate work to." collapsible defaultOpen={form.subagents.length > 0}>
        {#if availableSubagents.length === 0}
          <p class="text-[12px] text-text-tertiary">No other agents exist yet. Create one to enable delegation.</p>
        {:else}
          <div class="space-y-2">
            {#each availableSubagents as agent}
              {@const active = form.subagents.some((e) => e.agentId === agent.id)}
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors {active ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0 hover:border-border-strong'}"
                onclick={() => {
                  if (active) {
                    form.subagents = form.subagents.filter((e) => e.agentId !== agent.id)
                  } else {
                    form.subagents = [...form.subagents, {
                      agentId: agent.id,
                      alias: agent.slug,
                      description: agent.description,
                      name: agent.name,
                      slug: agent.slug,
                    }]
                  }
                }}
              >
                <span class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded border transition-colors {active ? 'border-accent bg-accent' : 'border-border-strong bg-surface-1'}">
                  {#if active}
                    <svg class="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  {/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium text-text-primary">{agent.name}</span>
                  {#if agent.description}
                    <span class="block truncate text-[11px] text-text-tertiary">{agent.description}</span>
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        {/if}
        {#if fieldErrors.subagents}
          <span class="mt-3 block text-[11px] text-danger-text">{fieldErrors.subagents}</span>
        {/if}
      </SectionCard>

      <!-- Actions -->
      <div class="flex items-center justify-between border-t border-border pt-4">
        <div class="flex items-center gap-2">
          {#if editingAgentId}
            {#if !isDefaultForAccount}
              <ActionButton
                disabled={isSettingDefault}
                onclick={() => { void makeDefaultTarget() }}
              >
                {isSettingDefault ? 'Setting…' : 'Set as Default'}
              </ActionButton>
            {/if}
            <ActionButton onclick={duplicateAgent}>Duplicate</ActionButton>
            <ActionButton
              variant="danger"
              disabled={deletingAgentId === editingAgentId}
              onclick={() => { void removeAgent() }}
            >
              {#if deletingAgentId === editingAgentId}
                Deleting…
              {:else if isConfirmingDelete}
                Confirm delete?
              {:else}
                Delete
              {/if}
            </ActionButton>
          {/if}
        </div>
        <ActionButton variant="primary" type="submit" disabled={isSaving}>
          {isSaving ? 'Saving…' : editingAgentId ? 'Save Changes' : 'Create Agent'}
        </ActionButton>
      </div>
    </form>
  {/if}
</div>

<style>
  .sd-agent-instructions :global(.sd-prompt-shell) { min-height: 180px; }
  .sd-agent-instructions :global(.sd-prompt-editor .ProseMirror) { min-height: 160px; max-height: 50vh; font-family: var(--font-mono); }
</style>
