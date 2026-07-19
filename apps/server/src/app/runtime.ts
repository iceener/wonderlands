import { resolve } from 'node:path'
import { createGoogleImageProvider } from '../adapters/ai/google/google-image-provider'
import { createGoogleProvider } from '../adapters/ai/google/google-provider'
import { createOpenAiImageProvider } from '../adapters/ai/openai/openai-image-provider'
import { createOpenAiProvider } from '../adapters/ai/openai/openai-provider'
import { createOpenRouterImageProvider } from '../adapters/ai/openrouter/openrouter-image-provider'
import { createOpenRouterProvider } from '../adapters/ai/openrouter/openrouter-provider'
import { createLocalBlobStore } from '../adapters/blob/local-blob-store'
import { createMcpGateway } from '../adapters/mcp/gateway'
import type { McpGateway, McpServerConfig } from '../adapters/mcp/types'
import {
  createLangfuseExporter,
  type LangfuseExporter,
} from '../adapters/observability/langfuse/exporter'
import { createGardenBuildRepository } from '../adapters/persistence/sqlite'
import { createSandboxRunner } from '../adapters/sandbox'
import {
  type AgentTaskWorker,
  createAgentTaskWorker,
} from '../application/agent-tasks/agent-task-worker'
import { registerAgentNativeTools } from '../application/agents/register-agent-native-tools'
import { registerOutboxWakeListener } from '../application/events/outbox-signal'
import {
  createEventOutboxWorker,
  createObservabilityOutboxWorker,
  type EventOutboxWorker,
} from '../application/events/outbox-worker'
import {
  createRealtimeEventRelay,
  type RealtimeEventRelay,
} from '../application/events/realtime-relay'
import {
  createGardenAutoBuildWorker,
  type GardenAutoBuildWorker,
} from '../application/garden/garden-auto-build-worker'
import {
  type AiImageGenerationService,
  createAiImageGenerationService,
} from '../application/images/image-generation-service'
import {
  type AiInteractionService,
  createAiInteractionService,
} from '../application/interactions/interaction-service'
import { createKernelArtifactService } from '../application/kernel/kernel-artifacts'
import { createKernelBrowserService } from '../application/kernel/kernel-browser-service'
import {
  createKernelRuntimeService,
  type KernelRuntimeService,
} from '../application/kernel/kernel-runtime-service'
import { registerKernelNativeTools } from '../application/kernel/register-kernel-native-tools'
import {
  type ActiveRunRegistry,
  createActiveRunRegistry,
} from '../application/runtime/active-run-registry'
import {
  createMultiagentWorker,
  type MultiagentWorker,
} from '../application/runtime/scheduling/multiagent-worker'
import { registerSandboxNativeTools } from '../application/sandbox/register-sandbox-native-tools'
import {
  createSandboxExecutionService,
  type SandboxExecutionService,
} from '../application/sandbox/sandbox-execution-service'
import {
  createSandboxReadModelService,
  type SandboxReadModelService,
} from '../application/sandbox/sandbox-read-model'
import {
  createSandboxReviewService,
  type SandboxReviewService,
} from '../application/sandbox/sandbox-review-service'
import { createSandboxWorker, type SandboxWorker } from '../application/sandbox/sandbox-worker'
import {
  createSandboxWritebackService,
  type SandboxWritebackService,
} from '../application/sandbox/sandbox-writeback'
import { type AppDatabase, createDatabaseClient } from '../db/client'
import type { AiImageModelRegistry } from '../domain/ai/image-types'
import type { AiModelRegistry } from '../domain/ai/types'
import type { BlobStore } from '../domain/files/blob-store'
import { createToolRegistry, type ToolRegistry } from '../domain/tooling/tool-registry'
import { createPrefixedId } from '../shared/ids'
import { type AppLogger, createLogger } from '../shared/logger'
import { type Clock, createSystemClock } from '../shared/time'
import type { AppConfig } from './config'

export interface AppServices {
  activeRuns: ActiveRunRegistry
  agentTasks: {
    worker: AgentTaskWorker
  }
  ai: {
    images: AiImageGenerationService
    imageModelRegistry: AiImageModelRegistry
    interactions: AiInteractionService
    modelRegistry: AiModelRegistry
    imageProviders: {
      google: ReturnType<typeof createGoogleImageProvider>
      openai: ReturnType<typeof createOpenAiImageProvider>
      openrouter: ReturnType<typeof createOpenRouterImageProvider>
    }
    providers: {
      google: ReturnType<typeof createGoogleProvider>
      openai: ReturnType<typeof createOpenAiProvider>
      openrouter: ReturnType<typeof createOpenRouterProvider>
    }
  }
  clock: Clock
  events: {
    outbox: EventOutboxWorker
    realtime: RealtimeEventRelay
  }
  files: {
    blobStore: BlobStore
  }
  garden: {
    worker: GardenAutoBuildWorker
  }
  kernel: KernelRuntimeService
  ids: {
    create: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
  }
  logger: AppLogger
  mcp: McpGateway
  multiagent: MultiagentWorker
  observability: {
    langfuse: LangfuseExporter
    worker: EventOutboxWorker
  }
  sandbox: {
    executions: SandboxExecutionService
    read: SandboxReadModelService
    review: SandboxReviewService
    writeback: SandboxWritebackService
    worker: SandboxWorker
  }
  tools: ToolRegistry
}

export interface AppRuntime {
  config: AppConfig
  db: AppDatabase
  services: AppServices
}

const outboxWakeCleanup = new WeakMap<AppRuntime, () => void>()

const requireInitializedService = <TValue>(value: TValue | null, name: string): TValue => {
  if (value) {
    return value
  }

  throw new Error(`${name} was accessed before runtime initialization completed`)
}

export const resolveRuntimeMcpServers = (
  servers: McpServerConfig[],
  fileStorageRoot: string,
): McpServerConfig[] => {
  const workspacesRoot = resolve(fileStorageRoot, '..', 'workspaces')

  return servers.map((server) => {
    if (server.kind !== 'stdio' || !server.workspaceScoped) {
      return server
    }

    const { FS_ROOT: _legacyFsRoot, ...serverEnv } = server.env ?? {}

    return {
      ...server,
      env: {
        ...serverEnv,
        FS_ROOTS: workspacesRoot,
      },
    }
  })
}

export const createAppRuntime = (config: AppConfig): AppRuntime => {
  const db = createDatabaseClient(config)
  const openaiProvider = createOpenAiProvider({
    apiKey: config.ai.providers.openai.apiKey,
    baseUrl: config.ai.providers.openai.baseUrl,
    defaultServiceTier: config.ai.providers.openai.serviceTier,
    maxRetries: config.ai.defaults.maxRetries,
    organization: config.ai.providers.openai.organization,
    project: config.ai.providers.openai.project,
    timeoutMs: config.ai.defaults.timeoutMs,
    webhookSecret: config.ai.providers.openai.webhookSecret,
  })
  const googleProvider = createGoogleProvider({
    apiKey: config.ai.providers.google.apiKey,
    apiVersion: config.ai.providers.google.apiVersion,
    baseUrl: config.ai.providers.google.baseUrl,
    defaultHttpTimeoutMs: config.ai.defaults.timeoutMs,
    location: config.ai.providers.google.location,
    maxRetries: config.ai.defaults.maxRetries,
    project: config.ai.providers.google.project,
    vertexai: config.ai.providers.google.vertexai,
  })
  const openRouterProvider = createOpenRouterProvider({
    apiKey: config.ai.providers.openrouter.apiKey,
    appCategories: config.ai.providers.openrouter.appCategories,
    appTitle: config.ai.providers.openrouter.appTitle,
    baseUrl: config.ai.providers.openrouter.baseUrl,
    httpReferer: config.ai.providers.openrouter.httpReferer,
    maxRetries: config.ai.defaults.maxRetries,
    timeoutMs: config.ai.defaults.timeoutMs,
  })
  const providers = {
    google: googleProvider,
    openai: openaiProvider,
    openrouter: openRouterProvider,
  }
  const googleImageProvider = createGoogleImageProvider({
    apiKey: config.ai.providers.google.apiKey,
    apiVersion: config.ai.providers.google.apiVersion,
    baseUrl: config.ai.providers.google.baseUrl,
    defaultHttpTimeoutMs: config.ai.defaults.timeoutMs,
    location: config.ai.providers.google.location,
    maxRetries: config.ai.defaults.maxRetries,
    project: config.ai.providers.google.project,
    vertexai: config.ai.providers.google.vertexai,
  })
  const openAiImageProvider = createOpenAiImageProvider({
    apiKey: config.ai.providers.openai.apiKey,
    baseUrl: config.ai.providers.openai.baseUrl,
    defaultServiceTier: config.ai.providers.openai.serviceTier,
    maxRetries: config.ai.defaults.maxRetries,
    organization: config.ai.providers.openai.organization,
    project: config.ai.providers.openai.project,
    timeoutMs: config.ai.defaults.timeoutMs,
    webhookSecret: config.ai.providers.openai.webhookSecret,
  })
  const openRouterImageProvider = createOpenRouterImageProvider({
    apiKey: config.ai.providers.openrouter.apiKey,
    appCategories: config.ai.providers.openrouter.appCategories,
    appTitle: config.ai.providers.openrouter.appTitle,
    baseUrl: config.ai.providers.openrouter.baseUrl,
    httpReferer: config.ai.providers.openrouter.httpReferer,
    maxRetries: config.ai.defaults.maxRetries,
    timeoutMs: config.ai.defaults.timeoutMs,
  })
  const blobStore = createLocalBlobStore({
    root: resolve(config.files.storage.root, '..'),
  })
  const ids = {
    create: createPrefixedId,
  }
  const logger = createLogger(config.observability.logLevel)
  const langfuse = createLangfuseExporter({
    config: config.observability.langfuse,
    db,
    logger,
  })
  const tools = createToolRegistry()
  const realtime = createRealtimeEventRelay()
  registerAgentNativeTools(tools, {
    db,
    fileStorageRoot: config.files.storage.root,
  })
  const kernel = createKernelRuntimeService({
    config: config.kernel,
    logger,
  })
  const kernelArtifacts = createKernelArtifactService({
    blobStore,
    createId: ids.create,
    db,
    fileStorageRoot: config.files.storage.root,
  })
  const kernelBrowser = createKernelBrowserService({
    artifactService: kernelArtifacts,
    db,
  })
  registerKernelNativeTools(tools, {
    browser: kernelBrowser,
    db,
  })
  const sandboxRunner = createSandboxRunner({
    logger,
    lo: config.sandbox.lo,
    provider: config.sandbox.provider,
  })
  const sandboxExecutions = createSandboxExecutionService({
    db,
    provider: sandboxRunner.provider,
    supportedRuntimes: sandboxRunner.supportedRuntimes,
  })
  const sandboxReadModel = createSandboxReadModelService(db)
  const sandboxReview = createSandboxReviewService(db)
  const sandboxWriteback = createSandboxWritebackService({
    createId: ids.create,
    db,
    fileStorageRoot: config.files.storage.root,
  })
  registerSandboxNativeTools(tools, {
    db,
    sandbox: sandboxExecutions,
    writeback: sandboxWriteback,
  })
  const mcp = createMcpGateway({
    clientInfo: {
      name: config.app.name,
      version: config.api.version,
    },
    db,
    logger,
    secretEncryptionKey: config.mcp.secretEncryptionKey,
    servers: resolveRuntimeMcpServers(config.mcp.servers, config.files.storage.root),
    toolRegistry: tools,
  })
  const aiInteractions = createAiInteractionService({
    providers,
    registry: config.ai.modelRegistry,
  })
  const aiImages = createAiImageGenerationService({
    providers: {
      google: googleImageProvider,
      openai: openAiImageProvider,
      openrouter: openRouterImageProvider,
    },
    registry: config.ai.imageModelRegistry,
  })
  const activeRuns = createActiveRunRegistry()
  const clock = createSystemClock()
  const workerRefs: {
    agentTask: AgentTaskWorker | null
    gardenAutoBuild: GardenAutoBuildWorker | null
    multiagent: MultiagentWorker | null
    observabilityOutbox: EventOutboxWorker | null
    outbox: EventOutboxWorker | null
    sandbox: SandboxWorker | null
  } = {
    agentTask: null,
    gardenAutoBuild: null,
    multiagent: null,
    observabilityOutbox: null,
    outbox: null,
    sandbox: null,
  }
  const services: AppServices = {
    activeRuns,
    agentTasks: {
      get worker() {
        return requireInitializedService(workerRefs.agentTask, 'agent task worker')
      },
    },
    ai: {
      images: aiImages,
      imageModelRegistry: config.ai.imageModelRegistry,
      interactions: aiInteractions,
      imageProviders: {
        google: googleImageProvider,
        openai: openAiImageProvider,
        openrouter: openRouterImageProvider,
      },
      modelRegistry: config.ai.modelRegistry,
      providers,
    },
    clock,
    events: {
      get outbox() {
        return requireInitializedService(workerRefs.outbox, 'event outbox worker')
      },
      realtime,
    },
    files: {
      blobStore,
    },
    garden: {
      get worker() {
        return requireInitializedService(workerRefs.gardenAutoBuild, 'garden auto-build worker')
      },
    },
    kernel,
    ids,
    logger,
    mcp,
    get multiagent() {
      return requireInitializedService(workerRefs.multiagent, 'multiagent worker')
    },
    observability: {
      langfuse,
      get worker() {
        return requireInitializedService(
          workerRefs.observabilityOutbox,
          'observability outbox worker',
        )
      },
    },
    sandbox: {
      executions: sandboxExecutions,
      read: sandboxReadModel,
      review: sandboxReview,
      writeback: sandboxWriteback,
      get worker() {
        return requireInitializedService(workerRefs.sandbox, 'sandbox worker')
      },
    },
    tools,
  }
  const outbox = createEventOutboxWorker({
    backgroundRuntime: {
      config,
      db,
      services,
    },
    clock,
    config,
    db,
    logger,
    observability: {
      langfuse,
    },
    projectionRuntime: {
      config,
      db,
      services,
    },
    realtime,
  })
  const observabilityOutbox = createObservabilityOutboxWorker({
    backgroundRuntime: {
      config,
      db,
      services,
    },
    clock,
    config,
    db,
    logger,
    observability: {
      langfuse,
    },
    projectionRuntime: {
      config,
      db,
      services,
    },
    realtime,
  })
  const multiagent = createMultiagentWorker({
    config,
    db,
    services,
  })
  const gardenAutoBuild = createGardenAutoBuildWorker({
    config,
    db,
    services,
  })
  const agentTaskWorker = createAgentTaskWorker({
    config,
    db,
    services,
  })
  const sandboxWorker = createSandboxWorker({
    config,
    db,
    runner: sandboxRunner,
    services,
  })
  workerRefs.outbox = outbox
  workerRefs.agentTask = agentTaskWorker
  workerRefs.gardenAutoBuild = gardenAutoBuild
  workerRefs.observabilityOutbox = observabilityOutbox
  workerRefs.multiagent = multiagent
  workerRefs.sandbox = sandboxWorker

  const runtime = {
    config,
    db,
    services,
  }

  outboxWakeCleanup.set(
    runtime,
    registerOutboxWakeListener(() => {
      outbox.wake()
      observabilityOutbox.wake()
    }),
  )

  return runtime
}

export const initializeAppRuntime = async (runtime: AppRuntime): Promise<AppRuntime> => {
  const recoveredGardenBuilds = createGardenBuildRepository(runtime.db).recoverInterruptedBuilds({
    completedAt: runtime.services.clock.nowIso(),
    errorMessage: 'Garden build interrupted by application restart before completion',
  })

  if (!recoveredGardenBuilds.ok) {
    throw new Error(recoveredGardenBuilds.error.message)
  }

  if (recoveredGardenBuilds.value > 0) {
    runtime.services.logger.warn('Recovered interrupted Garden builds during startup', {
      recoveredBuildCount: recoveredGardenBuilds.value,
    })
  }

  const reconciledOutbox = runtime.services.events.outbox.reconcileProcessingEntries()

  if (!reconciledOutbox.ok) {
    throw new Error(reconciledOutbox.error.message)
  }

  const reconciledObservabilityOutbox =
    runtime.services.observability.worker.reconcileProcessingEntries()

  if (!reconciledObservabilityOutbox.ok) {
    throw new Error(reconciledObservabilityOutbox.error.message)
  }

  const reconciledStartup = await runtime.services.multiagent.reconcileDecisions({
    mode: 'startup',
  })

  if (!reconciledStartup.ok) {
    throw new Error(reconciledStartup.error.message)
  }

  await runtime.services.kernel.initialize()
  await runtime.services.mcp.initialize()
  if (runtime.config.app.env !== 'test') {
    runtime.services.events.outbox.start()
    runtime.services.observability.worker.start()
  }
  if (
    runtime.config.multiagent.profile === 'single_process' &&
    runtime.config.multiagent.worker.autoStart
  ) {
    runtime.services.multiagent.start()
  }
  if (runtime.config.garden.worker.autoStart) {
    runtime.services.garden.worker.start()
  }
  if (runtime.config.agentTasks.worker.autoStart) {
    runtime.services.agentTasks.worker.start()
  }
  if (runtime.config.app.env !== 'test') {
    runtime.services.sandbox.worker.start()
  }
  return runtime
}

export const closeAppRuntime = async (runtime: AppRuntime): Promise<void> => {
  outboxWakeCleanup.get(runtime)?.()
  outboxWakeCleanup.delete(runtime)
  await runtime.services.events.outbox.stop()
  await runtime.services.observability.worker.stop()
  await runtime.services.agentTasks.worker.stop()
  await runtime.services.garden.worker.stop()
  await runtime.services.kernel.close()
  await runtime.services.multiagent.stop()
  await runtime.services.sandbox.worker.stop()
  await runtime.services.mcp.close()
  await runtime.services.observability.langfuse.shutdown()
  runtime.db.close()
}
