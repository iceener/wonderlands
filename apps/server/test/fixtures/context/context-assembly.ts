import type { ThreadContextData } from '../../../src/application/interactions/context-bundle'
import type { McpCodeModeCatalog } from '../../../src/application/mcp/code-mode'
import type { ToolSpec } from '../../../src/application/tooling/tool-registry'
import type { MemoryRecordRecord } from '../../../src/domain/memory/memory-record-repository'
import type { ItemRecord } from '../../../src/domain/runtime/item-repository'
import type { SessionMessageRecord } from '../../../src/domain/sessions/session-message-repository'
import {
  asFileId,
  asGardenSiteId,
  asItemId,
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
} from '../../../src/shared/ids'
import { ok } from '../../../src/shared/result'

export const FIXTURE_NOW = '2026-04-01T12:00:00.000Z'

const tenantId = asTenantId('ten_context_characterization')
const sessionId = asWorkSessionId('ses_context_characterization')
const threadId = asSessionThreadId('thr_context_characterization')
const runId = asRunId('run_context_characterization')

export const createContext = (overrides: Partial<ThreadContextData> = {}): ThreadContextData => ({
  activeReflection: null,
  agentProfile: null,
  attachmentRefs: [],
  gardenContext: null,
  items: [],
  observations: [],
  pendingWaits: [],
  run: {
    actorAccountId: null,
    agentId: null,
    agentRevisionId: null,
    completedAt: null,
    configSnapshot: {},
    createdAt: FIXTURE_NOW,
    errorJson: null,
    id: runId,
    jobId: null,
    lastProgressAt: FIXTURE_NOW,
    parentRunId: null,
    resultJson: null,
    rootRunId: runId,
    sessionId,
    sourceCallId: null,
    staleRecoveryCount: 0,
    startedAt: FIXTURE_NOW,
    status: 'running',
    targetKind: 'assistant',
    task: 'Run the characterization task',
    tenantId,
    threadId,
    toolProfileId: null,
    turnCount: 0,
    updatedAt: FIXTURE_NOW,
    version: 1,
    workspaceId: null,
    workspaceRef: null,
  },
  summary: null,
  visibleFiles: [],
  visibleMessages: [],
  ...overrides,
})

export const createVisibleMessage = (input: {
  authorKind?: SessionMessageRecord['authorKind']
  id?: string
  sequence?: number
  text: string
}): SessionMessageRecord => ({
  authorAccountId: null,
  authorKind: input.authorKind ?? 'user',
  content: [{ text: input.text, type: 'text' }],
  createdAt: FIXTURE_NOW,
  id: asSessionMessageId(input.id ?? `msg_visible_${input.sequence ?? 1}`),
  metadata: null,
  runId: null,
  sequence: input.sequence ?? 1,
  sessionId,
  tenantId,
  threadId,
})

const createItem = (id: string, sequence: number, overrides: Partial<ItemRecord>): ItemRecord => ({
  arguments: null,
  callId: null,
  content: null,
  createdAt: FIXTURE_NOW,
  id: asItemId(id),
  name: null,
  output: null,
  providerPayload: null,
  role: null,
  runId,
  sequence,
  summary: null,
  tenantId,
  type: 'message',
  ...overrides,
})

export const createMessageItem = (input: {
  id: string
  role: NonNullable<ItemRecord['role']>
  sequence: number
  text: string
}): ItemRecord =>
  createItem(input.id, input.sequence, {
    content: [{ text: input.text, type: 'text' }],
    role: input.role,
    type: 'message',
  })

export const createDelegatedItems = (): ItemRecord[] => [
  createItem('itm_delegate_call_characterization', 1, {
    arguments: '{"agentAlias":"researcher","task":"Check the migration"}',
    callId: 'call_delegate_characterization',
    name: 'delegate_to_agent',
    type: 'function_call',
  }),
  createItem('itm_delegate_result_characterization', 2, {
    callId: 'call_delegate_characterization',
    output: JSON.stringify({
      childRunId: 'run_child_characterization',
      kind: 'completed',
      result: {
        outputText: 'The migration is ready.',
        provider: 'openai',
        usage: {
          inputTokens: 1234,
          outputTokens: 42,
        },
      },
      summary: 'The migration is ready.',
    }),
    providerPayload: {
      isError: false,
      name: 'delegate_to_agent',
    },
    type: 'function_call_output',
  }),
]

const createMemoryRecord = (
  id: string,
  kind: MemoryRecordRecord['kind'],
  content: MemoryRecordRecord['content'],
): MemoryRecordRecord => ({
  content,
  createdAt: FIXTURE_NOW,
  generation: 1,
  id,
  kind,
  ownerRunId: runId,
  parentRecordId: null,
  rootRunId: runId,
  scopeKind: 'run_local',
  scopeRef: runId,
  sessionId,
  status: 'active',
  tenantId,
  threadId,
  tokenCount: null,
  visibility: 'private',
})

export const createReflection = (): MemoryRecordRecord =>
  createMemoryRecord('mem_reflection_characterization', 'reflection', {
    reflection: 'Keep the migration behavior-first and preserve request ordering.',
    source: 'reflector_v1',
  })

export const createObservation = (): MemoryRecordRecord =>
  createMemoryRecord('mem_observation_characterization', 'observation', {
    observations: [
      { text: 'The caller expects deterministic layer order.' },
      { text: 'Volatile transcript changes must not invalidate the stable prefix.' },
    ],
    source: 'observer_v1',
  })

export const summaryFixture = {
  content: 'Earlier conversation established a behavior-preserving migration plan.',
  createdAt: FIXTURE_NOW,
  fromSequence: 1,
  id: 'sum_context_characterization',
  modelKey: 'fixture-model',
  previousSummaryId: null,
  runId,
  tenantId,
  throughSequence: 8,
  tokensAfter: 16,
  tokensBefore: 96,
  turnNumber: 4,
} satisfies NonNullable<ThreadContextData['summary']>

export const textAndImageFilesFixture: ThreadContextData['visibleFiles'] = [
  {
    dataUrl: null,
    fileId: asFileId('fil_characterization_notes'),
    messageId: null,
    mimeType: 'text/plain',
    originalFilename: 'notes.txt',
    textContent: 'Attached file: notes.txt\nMIME: text/plain\n\nLayer order matters.',
  },
  {
    dataUrl: 'data:image/png;base64,AQID',
    fileId: asFileId('fil_characterization_diagram'),
    messageId: null,
    mimeType: 'image/png',
    originalFilename: 'diagram.png',
    textContent: null,
  },
]

const gardenSite = {
  configPath: '/vault/quinn/_garden.yml',
  frontmatterReferencePath: '/vault/quinn/_meta/frontmatter.md',
  id: asGardenSiteId('gst_context_characterization'),
  isDefault: true,
  name: 'Quinn Notes',
  preferred: true,
  protectedAccessMode: 'none' as const,
  publicPath: '/vault/quinn/public',
  slug: 'quinn',
  sourceRoot: '/vault/quinn',
  sourceScopePath: 'quinn',
  status: 'active' as const,
}

export const gardenContextFixture: NonNullable<ThreadContextData['gardenContext']> = {
  accountVaultRoot: '/vault',
  configFilename: '_garden.yml',
  gardens: [gardenSite],
  preferredSlugs: ['quinn'],
  privateRoots: ['_meta', 'attachments', 'system'],
  publishableAssetsRoot: 'public',
  recommendedGarden: gardenSite,
  sandbox: {
    enabled: false,
    vaultMode: 'none',
  },
}

export const createTool = (name: string, domain: ToolSpec['domain'] = 'native'): ToolSpec => ({
  description: `Fixture definition for ${name}.`,
  domain,
  execute: async () => ok({ kind: 'immediate', output: null }),
  inputSchema: {
    additionalProperties: false,
    properties: {
      query: { type: 'string' },
    },
    required: ['query'],
    type: 'object',
  },
  name,
  strict: true,
})

const mcpToolBinding = {
  binding: 'docs.search',
  description: 'Search migration documentation.',
  executable: true,
  inputSchema: {
    additionalProperties: false,
    properties: { query: { type: 'string' } },
    required: ['query'],
    type: 'object',
  },
  member: 'search',
  namespace: 'docs',
  outputSchema: null,
  remoteName: 'search',
  runtimeName: 'docs__search',
  serverId: 'srv_docs_characterization',
  serverLabel: 'docs',
  title: 'Documentation Search',
}

export const mcpCatalogFixture: McpCodeModeCatalog = {
  servers: [
    {
      executableToolCount: 1,
      namespace: 'docs',
      serverId: 'srv_docs_characterization',
      serverLabel: 'docs',
      toolCount: 1,
      tools: [mcpToolBinding],
    },
  ],
  tools: [mcpToolBinding],
}
