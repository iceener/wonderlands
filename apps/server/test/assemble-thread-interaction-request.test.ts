import assert from 'node:assert/strict'
import { test } from 'vitest'

import { assembleThreadInteractionRequest } from '../src/application/interactions/assemble-thread-interaction-request'
import type { ThreadContextData } from '../src/application/interactions/context-bundle'
import type { ToolSpec } from '../src/domain/tooling/tool-registry'
import {
  asAgentRevisionId,
  asFileId,
  asGardenSiteId,
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
} from '../src/shared/ids'
import { ok } from '../src/shared/result'

const createContext = (): ThreadContextData => ({
  activeReflection: null,
  agentProfile: null,
  attachmentRefs: [],
  gardenContext: null,
  items: [],
  observations: [],
  pendingWaits: [],
  run: {
    agentId: null,
    agentRevisionId: null,
    completedAt: null,
    configSnapshot: {
      model: 'gpt-5.4',
      provider: 'openai',
    },
    createdAt: '2026-03-31T10:00:00.000Z',
    errorJson: null,
    id: asRunId('run_budget_tools'),
    lastProgressAt: null,
    parentRunId: null,
    resultJson: null,
    rootRunId: asRunId('run_budget_tools'),
    sessionId: asWorkSessionId('ses_budget_tools'),
    sourceCallId: null,
    startedAt: '2026-03-31T10:00:00.000Z',
    status: 'running',
    task: 'Plan the next milestone',
    tenantId: asTenantId('ten_budget_tools'),
    threadId: asSessionThreadId('thr_budget_tools'),
    toolProfileId: null,
    turnCount: 0,
    updatedAt: '2026-03-31T10:00:00.000Z',
    version: 1,
    jobId: null,
    workspaceId: null,
    workspaceRef: null,
  },
  summary: null,
  visibleFiles: [],
  visibleMessages: [],
})

const createTool = (): ToolSpec => ({
  description: 'Look up project data from an internal index.',
  domain: 'native',
  execute: async () =>
    ok({
      kind: 'immediate',
      output: null,
    }),
  inputSchema: {
    additionalProperties: false,
    properties: {
      filters: {
        description: 'Apply structured filters before searching. '.repeat(160),
        items: {
          type: 'string',
        },
        type: 'array',
      },
      query: {
        description: 'Plain-language search request for the internal index. '.repeat(160),
        type: 'string',
      },
    },
    required: ['query'],
    type: 'object',
  },
  name: 'lookup_internal_index',
  strict: true,
})

test('assembleThreadInteractionRequest budgets tool schemas from the same request shape it returns', () => {
  const withoutTools = assembleThreadInteractionRequest({
    activeTools: [],
    context: createContext(),
    nativeTools: [],
    overrides: {},
  })
  const withTools = assembleThreadInteractionRequest({
    activeTools: [createTool()],
    context: createContext(),
    nativeTools: ['web_search'],
    overrides: {},
  })

  assert.equal(withTools.request.allowParallelToolCalls, true)
  assert.deepEqual(withTools.request.nativeTools, ['web_search'])
  assert.equal(withTools.request.toolChoice, 'auto')
  assert.equal(withTools.request.tools?.[0]?.name, 'lookup_internal_index')
  assert.equal((withTools.bundle.budget.requestOverheadTokens ?? 0) > 0, true)
  assert.equal(
    withTools.bundle.budget.stablePrefixTokens > withoutTools.bundle.budget.stablePrefixTokens,
    true,
  )
  assert.equal(
    withTools.bundle.budget.rawEstimatedInputTokens >
      withoutTools.bundle.budget.rawEstimatedInputTokens,
    true,
  )
})

test('assembleThreadInteractionRequest renders subagents with descriptions and capability summaries', () => {
  const context = createContext()

  context.agentProfile = {
    instructionsMd: 'Route work to the best specialist.',
    revisionId: asAgentRevisionId('agr_dispatcher_v1'),
    subagents: [
      {
        alias: 'tony',
        childAgentId: 'agt_tony',
        childDescription: 'API researcher focused on runtime behavior and tool wiring.',
        childName: 'Tony',
        childSlug: 'tony',
        delegationMode: 'async_join',
        tools: [
          {
            description: 'Search the web for public information.',
            kind: 'provider',
            name: 'web_search',
            title: null,
          },
          {
            description: 'Search the project repository.',
            kind: 'mcp',
            name: 'repo_search',
            title: 'Repo Search',
          },
        ],
      },
    ],
  }

  const result = assembleThreadInteractionRequest({
    activeTools: [],
    context,
    nativeTools: [],
    overrides: {},
  })

  const agentProfileMessage = result.request.messages.find(
    (message) =>
      message.role === 'developer' &&
      message.content.some(
        (content) =>
          content.type === 'text' &&
          content.text.includes(
            'Allowed subagents for this run. Use the alias value as agentAlias',
          ),
      ),
  )

  assert.deepEqual(agentProfileMessage, {
    content: [
      {
        text:
          'Instructions:\n' +
          'Route work to the best specialist.\n\n' +
          'Allowed subagents for this run. Use the alias value as agentAlias when calling delegate_to_agent.\n\n' +
          'If a delegated child returns kind="suspended", this run stays responsible for orchestration. Gather the missing input yourself, then call resume_delegated_run with the returned childRunId and waitId.\n\n' +
          '- alias: tony\n' +
          '  name: Tony\n' +
          '  description: API researcher focused on runtime behavior and tool wiring.\n' +
          '  tools: web_search, repo_search',
        type: 'text',
      },
    ],
    role: 'developer',
  })
})

test('assembleThreadInteractionRequest does not duplicate active MCP tools into developer messages', () => {
  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Read project data from an MCP index.',
        domain: 'mcp',
        name: 'mcp_project_lookup',
      },
    ],
    context: createContext(),
    nativeTools: [],
    overrides: {},
  })

  assert.equal(
    result.request.messages.some(
      (message) =>
        message.role === 'developer' &&
        message.content.some(
          (content) =>
            content.type === 'text' &&
            content.text.includes('Active MCP tools currently available'),
        ),
    ),
    false,
  )
})

test('assembleThreadInteractionRequest hides direct MCP function schemas in code mode and emits catalog inventory', () => {
  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Search the MCP catalog.',
        name: 'search_tools',
      },
      {
        ...createTool(),
        description: 'Load exact MCP schemas and bindings.',
        name: 'get_tools',
      },
      {
        ...createTool(),
        description: 'Run MCP code in the sandbox.',
        name: 'execute',
      },
      {
        ...createTool(),
        description: 'Read project data from an MCP index.',
        domain: 'mcp',
        name: 'mcp_project_lookup',
      },
    ],
    context: createContext(),
    mcpCatalog: {
      servers: [
        {
          executableToolCount: 1,
          namespace: 'project',
          serverId: 'srv_project',
          serverLabel: 'project',
          toolCount: 1,
          tools: [
            {
              binding: 'project.project_lookup',
              description: 'Read project data from an MCP index.',
              executable: true,
              inputSchema: {
                additionalProperties: false,
                properties: {
                  query: {
                    type: 'string',
                  },
                },
                required: ['query'],
                type: 'object',
              },
              member: 'project_lookup',
              namespace: 'project',
              outputSchema: null,
              remoteName: 'project_lookup',
              runtimeName: 'project__project_lookup',
              serverId: 'srv_project',
              serverLabel: 'project',
              title: null,
            },
          ],
        },
      ],
      tools: [
        {
          binding: 'project.project_lookup',
          description: 'Read project data from an MCP index.',
          executable: true,
          inputSchema: {
            additionalProperties: false,
            properties: {
              query: {
                type: 'string',
              },
            },
            required: ['query'],
            type: 'object',
          },
          member: 'project_lookup',
          namespace: 'project',
          outputSchema: null,
          remoteName: 'project_lookup',
          runtimeName: 'project__project_lookup',
          serverId: 'srv_project',
          serverLabel: 'project',
          title: null,
        },
      ],
    },
    mcpMode: 'code',
    nativeTools: [],
    overrides: {},
  })

  assert.deepEqual([...(result.request.tools?.map((tool) => tool.name) ?? [])].sort(), [
    'execute',
    'get_tools',
    'search_tools',
  ])
  assert.equal(
    result.request.messages.some(
      (message) =>
        message.role === 'developer' &&
        message.content.some(
          (content) =>
            content.type === 'text' &&
            content.text.includes('MCP code mode is enabled.') &&
            content.text.includes(
              'In execute script mode, MCP bindings are only exposed after you load them with get_tools.',
            ) &&
            content.text.includes(
              'Do not use execute script mode to inspect globalThis or enumerate bindings.',
            ) &&
            content.text.includes('The runtime wraps your code in an awaited async function.') &&
            content.text.includes('Active MCP inventory:') &&
            content.text.includes('- project: project_lookup'),
        ),
    ),
    true,
  )
})

test('assembleThreadInteractionRequest renders garden context with /vault navigation guidance', () => {
  const context = createContext()

  context.gardenContext = {
    accountVaultRoot: '/vault',
    configFilename: '_garden.yml',
    gardens: [
      {
        configPath: '/vault/overment/_garden.yml',
        frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
        id: asGardenSiteId('gst_overment'),
        isDefault: true,
        name: 'Overment',
        preferred: true,
        protectedAccessMode: 'none',
        publicPath: '/vault/overment/public',
        slug: 'overment',
        sourceRoot: '/vault/overment',
        sourceScopePath: 'overment',
        status: 'active',
      },
    ],
    preferredSlugs: ['overment'],
    privateRoots: ['_meta', 'attachments', 'system'],
    publishableAssetsRoot: 'public',
    recommendedGarden: {
      configPath: '/vault/overment/_garden.yml',
      frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
      id: asGardenSiteId('gst_overment'),
      isDefault: true,
      name: 'Overment',
      preferred: true,
      protectedAccessMode: 'none',
      publicPath: '/vault/overment/public',
      slug: 'overment',
      sourceRoot: '/vault/overment',
      sourceScopePath: 'overment',
      status: 'active',
    },
    sandbox: {
      enabled: false,
      vaultMode: 'none',
    },
  }

  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Read Garden workspace context.',
        name: 'get_garden_context',
      },
    ],
    context,
    nativeTools: [],
    overrides: {},
  })

  const gardenMessage = result.request.messages.find(
    (message) =>
      message.role === 'developer' &&
      message.content.some(
        (content) =>
          content.type === 'text' &&
          content.text.includes('Garden context:') &&
          content.text.includes('/vault/overment') &&
          content.text.includes('If you need structured details, call get_garden_context.'),
      ),
  )

  assert.deepEqual(gardenMessage, {
    content: [
      {
        text:
          'Garden context:\n\n' +
          'Garden sites are file-first websites built from the current account workspace under /vault.\n\n' +
          'How to navigate:\n' +
          '- Use /vault paths with file tools, not tenant/account filesystem paths.\n' +
          '- Garden is file-first editorial state. Treat `_garden.yml`, markdown files, and `public/**` assets in the selected source root as the source of truth, not a separate CMS/database view.\n' +
          '- Each garden source scope root must contain _garden.yml.\n' +
          '- Each garden source root also keeps a private frontmatter reference at <garden-root>/_meta/frontmatter.md. Read it when you need the full page field list or example syntax.\n' +
          '- Publishable assets live under public/.\n' +
          '- In Garden markdown, embed publishable assets with /public/... or public/... paths, not guessed final site URLs.\n' +
          '- Treat _meta, attachments, system as private, not publishable.\n\n' +
          'Protected routes:\n' +
          '- visibility: protected still requires the page path to be included by _garden.yml publishing roots; visibility: private publishes no route at all.\n' +
          '- Protected pages are hidden from the public menu/sidebar, so reach them through a direct link or direct URL.\n' +
          '- Site passwords unlock only protected routes. Public pages stay public.\n' +
          '- Open the protected page at its normal route, then unlock it there. Default gardens use /page-path with /_auth/unlock. Non-default gardens use /<garden-slug>/page-path with /<garden-slug>/_auth/unlock.\n' +
          '- A successful unlock sets the site cookie for that garden and redirects back to the protected route.\n\n' +
          'Available gardens in this workspace:\n' +
          '- overment (default, active, preferred) -> /vault/overment\n\n' +
          'If you need structured details, call get_garden_context.',
        type: 'text',
      },
    ],
    role: 'developer',
  })
})

test('assembleThreadInteractionRequest adds sandbox-first Garden guidance for read-write vault access', () => {
  const context = createContext()

  context.gardenContext = {
    accountVaultRoot: '/vault',
    configFilename: '_garden.yml',
    gardens: [
      {
        configPath: '/vault/overment/_garden.yml',
        frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
        id: asGardenSiteId('gst_overment'),
        isDefault: true,
        name: 'Overment',
        preferred: true,
        protectedAccessMode: 'none',
        publicPath: '/vault/overment/public',
        slug: 'overment',
        sourceRoot: '/vault/overment',
        sourceScopePath: 'overment',
        status: 'active',
      },
    ],
    preferredSlugs: ['overment'],
    privateRoots: ['_meta', 'attachments', 'system'],
    publishableAssetsRoot: 'public',
    recommendedGarden: {
      configPath: '/vault/overment/_garden.yml',
      frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
      id: asGardenSiteId('gst_overment'),
      isDefault: true,
      name: 'Overment',
      preferred: true,
      protectedAccessMode: 'none',
      publicPath: '/vault/overment/public',
      slug: 'overment',
      sourceRoot: '/vault/overment',
      sourceScopePath: 'overment',
      status: 'active',
    },
    sandbox: {
      enabled: true,
      vaultMode: 'read_write',
    },
  }

  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Execute sandbox tasks.',
        name: 'execute',
      },
    ],
    context,
    nativeTools: [],
    overrides: {},
  })

  const developerTexts = result.request.messages.flatMap((message) =>
    message.role === 'developer'
      ? message.content.flatMap((content) => (content.type === 'text' ? [content.text] : []))
      : [],
  )

  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Garden is file-first editorial state. Treat `_garden.yml`, markdown files, and `public/**` assets in the selected source root as the source of truth, not a separate CMS/database view.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Prefer execute for Garden file manipulation, shell-style inspection, and lightweight staged edits.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'For this garden, prefer garden: "overment" instead of manual vaultInputs/cwdVaultPath.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Write generated files under /output/... and use outputs.writeBack to request changes back into /vault/.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'execute bash mode uses just-bash under the hood, so prefer execute over hand-written just-bash wrapper code.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'execute bash mode only exposes the curated just-bash command set, not arbitrary host executables.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Use execute with `mode: "script"` only when you need custom scripts, MCP code-mode scripts, npm packages, or structured parsing/transforms.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'In execute `mode: "script"`, inline JavaScript normally runs as an ES module. Prefer `await import(...)`, avoid `require(...)`, and outside MCP code mode do not use top-level `return`. When MCP code mode is active, write a script body, not a full module: the runtime wraps your code in an async function, so `return` is allowed there but static top-level `import`/`export` is not.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Sandbox edits stay sandbox-local until requested through `outputs.writeBack` and later applied by `commit_sandbox_writeback`.',
      ),
    ),
    true,
  )
})

test('assembleThreadInteractionRequest limits Garden sandbox guidance for read-only vault access', () => {
  const context = createContext()

  context.gardenContext = {
    accountVaultRoot: '/vault',
    configFilename: '_garden.yml',
    gardens: [
      {
        configPath: '/vault/overment/_garden.yml',
        frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
        id: asGardenSiteId('gst_overment'),
        isDefault: true,
        name: 'Overment',
        preferred: true,
        protectedAccessMode: 'none',
        publicPath: '/vault/overment/public',
        slug: 'overment',
        sourceRoot: '/vault/overment',
        sourceScopePath: 'overment',
        status: 'active',
      },
    ],
    preferredSlugs: ['overment'],
    privateRoots: ['_meta', 'attachments', 'system'],
    publishableAssetsRoot: 'public',
    recommendedGarden: {
      configPath: '/vault/overment/_garden.yml',
      frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
      id: asGardenSiteId('gst_overment'),
      isDefault: true,
      name: 'Overment',
      preferred: true,
      protectedAccessMode: 'none',
      publicPath: '/vault/overment/public',
      slug: 'overment',
      sourceRoot: '/vault/overment',
      sourceScopePath: 'overment',
      status: 'active',
    },
    sandbox: {
      enabled: true,
      vaultMode: 'read_only',
    },
  }

  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Execute sandbox tasks.',
        name: 'execute',
      },
    ],
    context,
    nativeTools: [],
    overrides: {},
  })

  const developerTexts = result.request.messages.flatMap((message) =>
    message.role === 'developer'
      ? message.content.flatMap((content) => (content.type === 'text' ? [content.text] : []))
      : [],
  )

  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Garden is file-first editorial state. Treat `_garden.yml`, markdown files, and `public/**` assets in the selected source root as the source of truth, not a separate CMS/database view.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Prefer execute for Garden analysis, shell-style inspection, and transforms that should not write back directly.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'For this garden, prefer garden: "overment" instead of manual vaultInputs/cwdVaultPath.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Sandbox vault access is read-only for this agent, so Garden edits cannot be written back from the sandbox.',
      ),
    ),
    true,
  )
})

test('assembleThreadInteractionRequest injects attachment ref rules and context', () => {
  const context = createContext()

  context.attachmentRefs = [
    {
      fileId: asFileId('fil_img_1'),
      indexInMessageAll: 1,
      indexInMessageByKind: 1,
      internalPath: '/vault/attachments/2026/04/04/im/fil_img_1.png',
      kind: 'image',
      messageCreatedAt: '2026-04-04T10:00:00.000Z',
      messageId: asSessionMessageId('msg_1'),
      messageSequence: 1,
      mimeType: 'image/png',
      name: 'whiteboard.png',
      ref: '{{attachment:msg_msg_1:kind:image:index:1}}',
      renderUrl: '/api/files/fil_img_1/content',
      sourceMessageState: 'live',
    },
    {
      fileId: asFileId('fil_doc_1'),
      indexInMessageAll: 2,
      indexInMessageByKind: 1,
      internalPath: '/vault/attachments/2026/04/04/do/fil_doc_1.md',
      kind: 'file',
      messageCreatedAt: '2026-04-04T10:00:00.000Z',
      messageId: asSessionMessageId('msg_1'),
      messageSequence: 1,
      mimeType: 'text/markdown',
      name: 'notes.md',
      ref: '{{attachment:msg_msg_1:kind:file:index:1}}',
      renderUrl: '/api/files/fil_doc_1/content',
      sourceMessageState: 'live',
    },
  ]

  const result = assembleThreadInteractionRequest({
    activeTools: [],
    context,
    nativeTools: [],
    overrides: {},
  })

  const developerTexts = result.request.messages.flatMap((message) =>
    message.role === 'developer'
      ? message.content.flatMap((content) => (content.type === 'text' ? [content.text] : []))
      : [],
  )

  assert.equal(
    developerTexts.some((text) =>
      text.includes('Attachments in each user message have message-scoped refs and ordinals.'),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'attachment[n], file[n], and image[n] are reasoning aliases only. Do not pass them literally to tools.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes('Direct sandbox or workspace-files access is not available for this run.'),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) => text.includes('Attachment refs for visible message msg_1:')),
    true,
  )
  assert.equal(
    developerTexts.some(
      (text) =>
        text.includes(
          'image[1] alias -> tool ref {{attachment:msg_msg_1:kind:image:index:1}} (whiteboard.png)',
        ) && text.includes('url: /api/files/fil_img_1/content'),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'attachment[2] alias -> tool ref {{attachment:msg_msg_1:kind:file:index:1}} (notes.md)',
      ),
    ),
    true,
  )
})

test('assembleThreadInteractionRequest prefers sandbox attachment guidance over workspace file tools', () => {
  const context = createContext()

  context.attachmentRefs = [
    {
      fileId: asFileId('fil_doc_1'),
      indexInMessageAll: 1,
      indexInMessageByKind: 1,
      internalPath: '/vault/attachments/2026/04/04/do/fil_doc_1.md',
      kind: 'file',
      messageCreatedAt: '2026-04-04T10:00:00.000Z',
      messageId: asSessionMessageId('msg_1'),
      messageSequence: 1,
      mimeType: 'text/markdown',
      name: 'notes.md',
      ref: '{{attachment:msg_msg_1:kind:file:index:1}}',
      renderUrl: '/api/files/fil_doc_1/content',
      sourceMessageState: 'live',
    },
  ]

  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Execute sandbox task.',
        name: 'execute',
      },
      {
        ...createTool(),
        description: 'Read files.',
        domain: 'mcp',
        name: 'files__fs_read',
      },
    ],
    context,
    nativeTools: [],
    overrides: {},
  })

  const developerTexts = result.request.messages.flatMap((message) =>
    message.role === 'developer'
      ? message.content.flatMap((content) => (content.type === 'text' ? [content.text] : []))
      : [],
  )

  assert.equal(
    developerTexts.some((text) => text.includes('execute.attachments[].fileId')),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes('Pass attachment refs directly in execute.attachments[].fileId.'),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'When authoring Garden content from an attachment, copy publishable files into public/** and reference them in markdown as /public/... or public/..., not as guessed live page URLs.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Use execute as the default choice for `find`, `rg`, `grep`, `ls`, `cat`, `head`, `tail`, `sed`, and simple pipes over mounted files.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes('execute bash mode uses just-bash, not host bash.'),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) => text.includes('Do not pass `source` as a bare string.')),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Use execute with `mode: "script"` only when you need custom JavaScript, MCP code-mode scripts, npm packages, or structured parsing/transforms.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'In execute `mode: "script"`, inline JavaScript normally runs as an ES module. Prefer `await import(...)`, avoid `require(...)`, and outside MCP code mode do not use top-level `return`. When MCP code mode is active, write a script body, not a full module: the runtime wraps your code in an async function, so `return` is allowed there but static top-level `import`/`export` is not.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        '/input exists only for staged attachments. /vault paths exist in the sandbox only if the job mounts them with vaultInputs or cwdVaultPath.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Sandbox edits remain staged until you request `outputs.writeBack` and later apply them with `commit_sandbox_writeback`.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes('path: /vault/attachments/2026/04/04/do/fil_doc_1.md'),
    ),
    false,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'sandbox: use this ref in execute.attachments[].fileId; it will mount under /input/...',
      ),
    ),
    true,
  )
})

test('assembleThreadInteractionRequest warns that generate_image expects file ids or attachment refs, not attachment paths', () => {
  const context = createContext()

  context.attachmentRefs = [
    {
      fileId: asFileId('fil_img_1'),
      indexInMessageAll: 1,
      indexInMessageByKind: 1,
      internalPath: '/vault/attachments/2026/04/04/im/fil_img_1.png',
      kind: 'image',
      messageCreatedAt: '2026-04-04T10:00:00.000Z',
      messageId: asSessionMessageId('msg_1'),
      messageSequence: 1,
      mimeType: 'image/png',
      name: 'whiteboard.png',
      ref: '{{attachment:msg_msg_1:kind:image:index:1}}',
      renderUrl: '/api/files/fil_img_1/content',
      sourceMessageState: 'live',
    },
  ]

  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Generate or edit images.',
        name: 'generate_image',
      },
      {
        ...createTool(),
        description: 'Read files.',
        domain: 'mcp',
        name: 'files__fs_read',
      },
    ],
    context,
    nativeTools: [],
    overrides: {},
  })

  const developerTexts = result.request.messages.flatMap((message) =>
    message.role === 'developer'
      ? message.content.flatMap((content) => (content.type === 'text' ? [content.text] : []))
      : [],
  )

  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'For `generate_image.references[].fileId`, pass a real `fil_*` id or the full {{attachment:...}} token. Do not pass `/vault/attachments/...` paths, `/api/files/...` URLs, or markdown there.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'generate_image: pass this tool ref in references[].fileId, or a real fil_* id. Do not pass the path or URL variant there.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes('path: /vault/attachments/2026/04/04/im/fil_img_1.png'),
    ),
    true,
  )
})

test('assembleThreadInteractionRequest prefers execute guidance when sandbox execute is active', () => {
  const context = createContext()

  context.attachmentRefs = [
    {
      fileId: asFileId('fil_doc_1'),
      indexInMessageAll: 1,
      indexInMessageByKind: 1,
      internalPath: '/vault/attachments/2026/04/04/do/fil_doc_1.md',
      kind: 'file',
      messageCreatedAt: '2026-04-04T10:00:00.000Z',
      messageId: asSessionMessageId('msg_1'),
      messageSequence: 1,
      mimeType: 'text/markdown',
      name: 'notes.md',
      ref: '{{attachment:msg_msg_1:kind:file:index:1}}',
      renderUrl: '/api/files/fil_doc_1/content',
      sourceMessageState: 'live',
    },
  ]

  context.gardenContext = {
    accountVaultRoot: '/vault',
    configFilename: '_garden.yml',
    gardens: [
      {
        configPath: '/vault/overment/_garden.yml',
        frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
        id: asGardenSiteId('gst_overment'),
        isDefault: true,
        name: 'Overment',
        preferred: true,
        protectedAccessMode: 'none',
        publicPath: '/vault/overment/public',
        slug: 'overment',
        sourceRoot: '/vault/overment',
        sourceScopePath: 'overment',
        status: 'active',
      },
    ],
    preferredSlugs: ['overment'],
    privateRoots: ['_meta', 'attachments', 'system'],
    publishableAssetsRoot: 'public',
    recommendedGarden: {
      configPath: '/vault/overment/_garden.yml',
      frontmatterReferencePath: '/vault/overment/_meta/frontmatter.md',
      id: asGardenSiteId('gst_overment'),
      isDefault: true,
      name: 'Overment',
      preferred: true,
      protectedAccessMode: 'none',
      publicPath: '/vault/overment/public',
      slug: 'overment',
      sourceRoot: '/vault/overment',
      sourceScopePath: 'overment',
      status: 'active',
    },
    sandbox: {
      enabled: true,
      vaultMode: 'read_write',
    },
  }

  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Execute sandbox task.',
        name: 'execute',
      },
    ],
    context,
    nativeTools: [],
    overrides: {},
  })

  const developerTexts = result.request.messages.flatMap((message) =>
    message.role === 'developer'
      ? message.content.flatMap((content) => (content.type === 'text' ? [content.text] : []))
      : [],
  )

  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Prefer execute for Garden file manipulation, shell-style inspection, and lightweight staged edits.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Use execute as the default choice for `find`, `rg`, `grep`, `ls`, `cat`, `head`, `tail`, `sed`, and simple pipes over staged Garden files.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'In execute bash mode, the selected Garden keeps its resolved /vault source root.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'execute bash mode uses just-bash, not host bash. Do not probe for system binaries like `magick`, `ffmpeg`, or `sips` with `which` there.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'execute bash mode is bash-like but not GNU-complete. Prefer conservative flags, avoid assuming options like `grep -H` or `grep -I` exist, and prefer direct recursive `grep` or `rg` over `find | while read ...` loops for simple searches.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'When a search may legitimately return no matches, append `|| true` so exit code `1` does not fail the whole execute call.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'execute can edit staged Garden files during the run, but real Garden persistence still requires `outputs.writeBack` plus `commit_sandbox_writeback`.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'execute bash mode uses just-bash under the hood, so prefer execute over hand-written just-bash wrapper code.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes('Pass attachment refs directly in execute.attachments[].fileId.'),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Use execute as the default choice for `find`, `rg`, `grep`, `ls`, `cat`, `head`, `tail`, `sed`, and simple pipes over mounted files.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'When a job sets `garden`, execute bash mode starts in that Garden source root (for example `/vault/overment`). Prefer relative paths from `pwd` like `_garden.yml` or `_meta/frontmatter.md`, and use absolute `/vault/...` paths only when a tool argument truly requires them.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'execute bash mode uses just-bash, not host bash. Do not probe for system binaries like `magick`, `ffmpeg`, or `sips` with `which` there.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'execute bash mode is bash-like but not GNU-complete. Prefer conservative flags, avoid assuming options like `grep -H` or `grep -I` exist, and prefer direct recursive `grep` or `rg` over `find | while read ...` loops for simple searches.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'When a search may legitimately return no matches, append `|| true` so exit code `1` does not fail the whole execute call.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Sandbox edits remain staged until you request `outputs.writeBack` and later apply them with `commit_sandbox_writeback`.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'In execute `mode: "script"`, inline JavaScript normally runs as an ES module. Prefer `await import(...)`, avoid `require(...)`, and outside MCP code mode do not use top-level `return`. When MCP code mode is active, write a script body, not a full module: the runtime wraps your code in an async function, so `return` is allowed there but static top-level `import`/`export` is not.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'sandbox: use this ref in execute.attachments[].fileId; it will mount under /input/...',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes('prefer just-bash instead of writing a custom fs walker.'),
    ),
    false,
  )
})

test('assembleThreadInteractionRequest shows workspace attachment paths when files MCP access exists', () => {
  const context = createContext()

  context.attachmentRefs = [
    {
      fileId: asFileId('fil_doc_1'),
      indexInMessageAll: 1,
      indexInMessageByKind: 1,
      internalPath: '/vault/attachments/2026/04/04/do/fil_doc_1.md',
      kind: 'file',
      messageCreatedAt: '2026-04-04T10:00:00.000Z',
      messageId: asSessionMessageId('msg_1'),
      messageSequence: 1,
      mimeType: 'text/markdown',
      name: 'notes.md',
      ref: '{{attachment:msg_msg_1:kind:file:index:1}}',
      renderUrl: '/api/files/fil_doc_1/content',
      sourceMessageState: 'live',
    },
  ]

  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Read files.',
        domain: 'mcp',
        name: 'files__fs_read',
      },
    ],
    context,
    nativeTools: [],
    overrides: {},
  })

  const developerTexts = result.request.messages.flatMap((message) =>
    message.role === 'developer'
      ? message.content.flatMap((content) => (content.type === 'text' ? [content.text] : []))
      : [],
  )

  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Workspace file tools can read attachments at the /vault/attachments/... paths shown below.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes('path: /vault/attachments/2026/04/04/do/fil_doc_1.md'),
    ),
    true,
  )
})

test('assembleThreadInteractionRequest adds browser capability guidance when browser and sandbox tools coexist', () => {
  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Run browser job.',
        name: 'browse',
      },
      {
        ...createTool(),
        description: 'Execute sandbox task.',
        name: 'execute',
      },
    ],
    context: createContext(),
    nativeTools: [],
    overrides: {},
  })

  const developerTexts = result.request.messages.flatMap((message) =>
    message.role === 'developer'
      ? message.content.flatMap((content) => (content.type === 'text' ? [content.text] : []))
      : [],
  )

  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        '`browse` is available for live website interaction: navigation, clicks, form filling, DOM inspection, screenshots, PDFs, cookies, and browser-state capture.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Sandbox tools are also available in this run. Use them for local file transforms, `/vault` work, package-backed processing, and non-browser parsing.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Prefer `execute` as the default sandbox tool. It defaults to `mode: "bash"` for quick `find`/`rg`/`ls`/`cat` style inspection over mounted files. Use `mode: "script"` when you need custom JavaScript, MCP code-mode scripts, packages, or structured parsing.',
      ),
    ),
    true,
  )
  assert.equal(
    developerTexts.some((text) =>
      text.includes(
        'Request screenshots, PDFs, HTML, cookies, or recordings only when they materially help the conversation. Those outputs become normal run attachments.',
      ),
    ),
    true,
  )
})
