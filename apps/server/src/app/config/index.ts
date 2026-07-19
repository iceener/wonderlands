import { resolve } from 'node:path'

import { z } from 'zod'

import type { McpServerConfig } from '../../adapters/mcp/types'
import type { AiImageModelRegistry } from '../../domain/ai/image-types'
import type { AiModelRegistry, AiProviderName } from '../../domain/ai/types'
import { type KernelProvider, kernelProviderValues } from '../../domain/kernel/types'
import { type SandboxProvider, sandboxProviderValues } from '../../domain/sandbox/types'
import { type AuthMethod, authMethodValues } from '../../shared/auth'
import {
  parseBasePath,
  parseBoolean,
  parseCsv,
  parseInteger,
  parseNonNegativeInteger,
  parseOptionalString,
  parseUnitInterval,
  parseUrl,
} from './env'
import { resolveMcpServers } from './mcp-servers'

const nodeEnvSchema = z.enum(['development', 'test', 'production'])
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])
const authModeSchema = z.enum(['api_key', 'disabled'])
const authMethodSchema = z.enum(authMethodValues)
const authSessionSameSiteSchema = z.enum(['lax', 'strict', 'none'])
const aiProviderSchema = z.enum(['openai', 'google', 'openrouter'])
const openAiServiceTierSchema = z.enum(['auto', 'default', 'flex', 'scale', 'priority'])
const fileStorageKindSchema = z.enum(['local'])
const kernelProviderSchema = z.enum(kernelProviderValues)
const multiagentRuntimeProfileSchema = z.enum(['single_process'])
const sandboxProviderSchema = z.enum(sandboxProviderValues)

const envSchema = z.object({
  API_BASE_PATH: z.string().optional(),
  AI_DEFAULT_MODEL: z.string().optional(),
  AI_DEFAULT_PROVIDER: z.string().optional(),
  AI_REQUEST_MAX_RETRIES: z.string().optional(),
  AI_REQUEST_TIMEOUT_MS: z.string().optional(),
  AUTH_METHODS: z.string().optional(),
  AUTH_MODE: z.string().optional(),
  AUTH_SESSION_COOKIE_NAME: z.string().optional(),
  AUTH_SESSION_MAX_AGE_SECONDS: z.string().optional(),
  AUTH_SESSION_SAME_SITE: z.string().optional(),
  AUTH_SESSION_SECURE: z.string().optional(),
  CORS_ALLOW_CREDENTIALS: z.string().optional(),
  CORS_ALLOW_HEADERS: z.string().optional(),
  CORS_ALLOW_METHODS: z.string().optional(),
  CORS_ALLOW_ORIGINS: z.string().optional(),
  CORS_EXPOSE_HEADERS: z.string().optional(),
  CORS_MAX_AGE_SECONDS: z.string().optional(),
  DATABASE_PATH: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GOOGLE_API_VERSION: z.string().optional(),
  GOOGLE_BASE_URL: z.string().optional(),
  GOOGLE_CLOUD_LOCATION: z.string().optional(),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_DEFAULT_MODEL: z.string().optional(),
  GOOGLE_IMAGE_DEFAULT_MODEL: z.string().optional(),
  GOOGLE_VERTEXAI: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_APP_CATEGORIES: z.string().optional(),
  OPENROUTER_APP_TITLE: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().optional(),
  OPENROUTER_DEFAULT_MODEL: z.string().optional(),
  OPENROUTER_IMAGE_DEFAULT_MODEL: z.string().optional(),
  OPENROUTER_HTTP_REFERER: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().optional(),
  LANGFUSE_ENABLED: z.string().optional(),
  LANGFUSE_ENVIRONMENT: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_TIMEOUT_MS: z.string().optional(),
  MEMORY_COMPACTION_RAW_ITEMS: z.string().optional(),
  MEMORY_OBSERVATION_TAIL_RATIO: z.string().optional(),
  MEMORY_OBSERVATION_TRIGGER_RATIO: z.string().optional(),
  MEMORY_REFLECTION_TRIGGER_RATIO: z.string().optional(),
  FILE_ALLOWED_MIME_TYPES: z.string().optional(),
  FILE_INLINE_TEXT_BYTES: z.string().optional(),
  FILE_MAX_UPLOAD_BYTES: z.string().optional(),
  FILE_STORAGE_KIND: z.string().optional(),
  FILE_STORAGE_ROOT: z.string().optional(),
  AGENT_TASK_WORKER_AUTO_START: z.string().optional(),
  AGENT_TASK_WORKER_BATCH_SIZE: z.string().optional(),
  AGENT_TASK_WORKER_POLL_MS: z.string().optional(),
  GARDEN_WORKER_AUTO_START: z.string().optional(),
  GARDEN_WORKER_DEBOUNCE_MS: z.string().optional(),
  GARDEN_WORKER_POLL_MS: z.string().optional(),
  HOST: z.string().optional(),
  KERNEL_API_KEY: z.string().optional(),
  KERNEL_API_URL: z.string().optional(),
  KERNEL_CDP_URL: z.string().optional(),
  KERNEL_ENABLED: z.string().optional(),
  KERNEL_LOCAL_API_URL: z.string().optional(),
  KERNEL_PROVIDER: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  MAX_REQUEST_BODY_BYTES: z.string().optional(),
  MULTIAGENT_LEASE_TTL_MS: z.string().optional(),
  MULTIAGENT_MAX_RUN_TURNS: z.string().optional(),
  MULTIAGENT_MAX_STALE_RECOVERIES: z.string().optional(),
  MULTIAGENT_STALE_RECOVERY_BASE_DELAY_MS: z.string().optional(),
  MULTIAGENT_WORKER_AUTO_START: z.string().optional(),
  MULTIAGENT_WORKER_POLL_MS: z.string().optional(),
  NODE_ENV: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_DEFAULT_MODEL: z.string().optional(),
  OPENAI_IMAGE_DEFAULT_MODEL: z.string().optional(),
  OPENAI_ORGANIZATION: z.string().optional(),
  OPENAI_PROJECT_ID: z.string().optional(),
  OPENAI_SERVICE_TIER: z.string().optional(),
  OPENAI_WEBHOOK_SECRET: z.string().optional(),
  PORT: z.string().optional(),
  SANDBOX_LO_BINARY: z.string().optional(),
  SANDBOX_LO_BOOTSTRAP_ENTRY: z.string().optional(),
  SANDBOX_PROVIDER: z.string().optional(),
  EVENT_STREAM_MAX_FOLLOW_MS: z.string().optional(),
  MCP_SERVERS_FILE: z.string().optional(),
  MCP_SECRET_ENCRYPTION_KEY: z.string().optional(),
})

const defaultCorsOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

const defaultCorsMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const defaultCorsHeaders = [
  'Accept',
  'Authorization',
  'Content-Type',
  'Idempotency-Key',
  'X-Request-Id',
  'X-Tenant-Id',
  'X-Trace-Id',
]
const defaultCorsExposeHeaders = [
  'X-Api-Version',
  'X-Request-Id',
  'X-Response-Time-Ms',
  'X-Trace-Id',
]

const deriveAuthMethodsFromMode = (authMode: z.infer<typeof authModeSchema>): AuthMethod[] => {
  switch (authMode) {
    case 'api_key':
      return ['api_key', 'auth_session']
    case 'disabled':
      return []
  }
}

const parseAuthMethods = (
  value: string | undefined,
  authMode: z.infer<typeof authModeSchema>,
): AuthMethod[] => {
  if (!value) {
    return deriveAuthMethodsFromMode(authMode)
  }

  const methods = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((method) => authMethodSchema.parse(method))

  return [...new Set(methods)]
}

export interface AppConfig {
  api: {
    basePath: string
    cors: {
      allowCredentials: boolean
      allowHeaders: string[]
      allowMethods: string[]
      allowOrigins: string[]
      exposeHeaders: string[]
      maxAgeSeconds: number
    }
    maxRequestBodyBytes: number
    version: string
  }
  ai: {
    imageModelRegistry: AiImageModelRegistry
    defaults: {
      maxRetries: number
      model: string
      provider: AiProviderName
      timeoutMs: number
    }
    modelRegistry: AiModelRegistry
    providers: {
      google: {
        apiKey: string | null
        apiVersion: string | null
        baseUrl: string | null
        defaultModel: string
        imageDefaultModel: string
        location: string | null
        project: string | null
        vertexai: boolean
      }
      openai: {
        apiKey: string | null
        baseUrl: string | null
        defaultModel: string
        imageDefaultModel: string
        organization: string | null
        project: string | null
        serviceTier: z.infer<typeof openAiServiceTierSchema> | null
        webhookSecret: string | null
      }
      openrouter: {
        apiKey: string | null
        appCategories: string | null
        appTitle: string | null
        baseUrl: string | null
        defaultModel: string
        imageDefaultModel: string
        httpReferer: string | null
      }
    }
  }
  files: {
    allowedMimeTypes: string[]
    inlineTextBytes: number
    maxUploadBytes: number
    storage: {
      kind: z.infer<typeof fileStorageKindSchema>
      root: string
    }
  }
  auth: {
    methods: AuthMethod[]
    mode: z.infer<typeof authModeSchema>
    session: {
      cookieName: string
      maxAgeSeconds: number
      sameSite: z.infer<typeof authSessionSameSiteSchema>
      secure: boolean
    }
  }
  agentTasks: {
    worker: {
      autoStart: boolean
      batchSize: number
      pollIntervalMs: number
    }
  }
  app: {
    env: z.infer<typeof nodeEnvSchema>
    name: string
  }
  database: {
    path: string
  }
  garden: {
    worker: {
      autoStart: boolean
      debounceWindowMs: number
      pollIntervalMs: number
    }
  }
  mcp: {
    secretEncryptionKey: string | null
    servers: McpServerConfig[]
  }
  kernel: {
    cloud: {
      apiKey: string | null
      apiUrl: string
    }
    enabled: boolean
    local: {
      apiUrl: string
      cdpUrl: string
    }
    provider: KernelProvider
  }
  memory: {
    compaction: {
      rawItemThreshold: number
      tailRatio: number
      triggerRatio: number
    }
    reflection: {
      triggerRatio: number
    }
  }
  multiagent: {
    leaseTtlMs: number
    maxRunTurns: number
    maxStaleRecoveries: number
    profile: z.infer<typeof multiagentRuntimeProfileSchema>
    staleRecoveryBaseDelayMs: number
    worker: {
      autoStart: boolean
      pollIntervalMs: number
    }
  }
  observability: {
    langfuse: {
      baseUrl: string | null
      enabled: boolean
      environment: string
      publicKey: string | null
      secretKey: string | null
      timeoutMs: number
    }
    logLevel: z.infer<typeof logLevelSchema>
  }
  server: {
    eventStreamMaxFollowMs: number
    host: string
    port: number
  }
  sandbox: {
    lo: {
      binaryPath: string | null
      bootstrapEntry: string | null
    }
    provider: SandboxProvider
  }
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const raw = envSchema.parse(env)

  const nodeEnv = nodeEnvSchema.parse(raw.NODE_ENV ?? 'development')
  const defaultAuthMode = 'api_key'
  const authMode = authModeSchema.parse(raw.AUTH_MODE ?? defaultAuthMode)
  const authMethods = parseAuthMethods(raw.AUTH_METHODS, authMode)
  const authSessionSecure = parseBoolean(
    raw.AUTH_SESSION_SECURE,
    nodeEnv === 'production',
    'AUTH_SESSION_SECURE',
  )
  const authSessionCookieName =
    raw.AUTH_SESSION_COOKIE_NAME?.trim() ||
    (authSessionSecure ? '__Host-05_04_session' : '05_04_session')
  const authSessionMaxAgeSeconds = parseInteger(
    raw.AUTH_SESSION_MAX_AGE_SECONDS,
    60 * 60 * 24 * 30,
    'AUTH_SESSION_MAX_AGE_SECONDS',
  )
  const authSessionSameSite = authSessionSameSiteSchema.parse(raw.AUTH_SESSION_SAME_SITE ?? 'lax')
  const logLevel = logLevelSchema.parse(raw.LOG_LEVEL ?? 'info')
  const host = raw.HOST?.trim() || '127.0.0.1'
  const port = parseInteger(raw.PORT, 3000, 'PORT')
  const basePath = parseBasePath(raw.API_BASE_PATH)
  const allowOrigins = parseCsv(raw.CORS_ALLOW_ORIGINS, defaultCorsOrigins)
  const allowCredentials = parseBoolean(raw.CORS_ALLOW_CREDENTIALS, true, 'CORS_ALLOW_CREDENTIALS')
  const openAiDefaultModel = raw.OPENAI_DEFAULT_MODEL?.trim() || 'gpt-5.4'
  const googleDefaultModel = raw.GOOGLE_DEFAULT_MODEL?.trim() || 'gemini-3.1-pro-preview'
  const openRouterDefaultModel = raw.OPENROUTER_DEFAULT_MODEL?.trim() || 'openai/gpt-5.4'
  const openAiImageDefaultModel = raw.OPENAI_IMAGE_DEFAULT_MODEL?.trim() || 'gpt-image-1.5'
  const googleImageDefaultModel = raw.GOOGLE_IMAGE_DEFAULT_MODEL?.trim() || 'gemini-3.1-flash-image'
  const openRouterImageDefaultModel =
    raw.OPENROUTER_IMAGE_DEFAULT_MODEL?.trim() || 'google/gemini-3.1-flash-image-preview'
  const openAiConfigured = Boolean(parseOptionalString(raw.OPENAI_API_KEY))
  const googleConfigured =
    Boolean(parseOptionalString(raw.GOOGLE_API_KEY)) ||
    (parseBoolean(raw.GOOGLE_VERTEXAI, false, 'GOOGLE_VERTEXAI') &&
      Boolean(parseOptionalString(raw.GOOGLE_CLOUD_PROJECT)) &&
      Boolean(parseOptionalString(raw.GOOGLE_CLOUD_LOCATION)))
  const openRouterConfigured = Boolean(parseOptionalString(raw.OPENROUTER_API_KEY))
  const defaultImageProviderAlias = googleConfigured
    ? 'google'
    : openAiConfigured
      ? 'openai'
      : openRouterConfigured
        ? 'openrouter'
        : null
  const defaultAiProvider = aiProviderSchema.parse(raw.AI_DEFAULT_PROVIDER ?? 'openai')
  const defaultAiModel =
    parseOptionalString(raw.AI_DEFAULT_MODEL) ??
    (defaultAiProvider === 'openai'
      ? openAiDefaultModel
      : defaultAiProvider === 'google'
        ? googleDefaultModel
        : openRouterDefaultModel)
  const aiTimeoutMs = parseInteger(raw.AI_REQUEST_TIMEOUT_MS, 60_000, 'AI_REQUEST_TIMEOUT_MS')
  const aiMaxRetries = parseNonNegativeInteger(
    raw.AI_REQUEST_MAX_RETRIES,
    2,
    'AI_REQUEST_MAX_RETRIES',
  )
  const maxRequestBodyBytes = parseInteger(
    raw.MAX_REQUEST_BODY_BYTES,
    1_048_576,
    'MAX_REQUEST_BODY_BYTES',
  )
  const fileMaxUploadBytes = parseInteger(
    raw.FILE_MAX_UPLOAD_BYTES,
    maxRequestBodyBytes,
    'FILE_MAX_UPLOAD_BYTES',
  )
  const gardenWorkerPollIntervalMs = parseInteger(
    raw.GARDEN_WORKER_POLL_MS,
    1_000,
    'GARDEN_WORKER_POLL_MS',
  )
  const gardenWorkerDebounceWindowMs = parseInteger(
    raw.GARDEN_WORKER_DEBOUNCE_MS,
    2_000,
    'GARDEN_WORKER_DEBOUNCE_MS',
  )
  const memoryRawItemThreshold = parseInteger(
    raw.MEMORY_COMPACTION_RAW_ITEMS,
    200,
    'MEMORY_COMPACTION_RAW_ITEMS',
  )
  const memoryObservationTriggerRatio = parseUnitInterval(
    raw.MEMORY_OBSERVATION_TRIGGER_RATIO,
    0.3,
    'MEMORY_OBSERVATION_TRIGGER_RATIO',
  )
  const memoryObservationTailRatio = parseUnitInterval(
    raw.MEMORY_OBSERVATION_TAIL_RATIO,
    0.3,
    'MEMORY_OBSERVATION_TAIL_RATIO',
  )
  const memoryReflectionTriggerRatio = parseUnitInterval(
    raw.MEMORY_REFLECTION_TRIGGER_RATIO,
    0.6,
    'MEMORY_REFLECTION_TRIGGER_RATIO',
  )
  const multiagentWorkerPollIntervalMs = parseInteger(
    raw.MULTIAGENT_WORKER_POLL_MS,
    500,
    'MULTIAGENT_WORKER_POLL_MS',
  )
  const multiagentLeaseTtlMs = parseInteger(
    raw.MULTIAGENT_LEASE_TTL_MS,
    30_000,
    'MULTIAGENT_LEASE_TTL_MS',
  )
  const multiagentMaxRunTurns = parseInteger(
    raw.MULTIAGENT_MAX_RUN_TURNS,
    32,
    'MULTIAGENT_MAX_RUN_TURNS',
  )
  const multiagentMaxStaleRecoveries = parseNonNegativeInteger(
    raw.MULTIAGENT_MAX_STALE_RECOVERIES,
    5,
    'MULTIAGENT_MAX_STALE_RECOVERIES',
  )
  const multiagentStaleRecoveryBaseDelayMs = parseNonNegativeInteger(
    raw.MULTIAGENT_STALE_RECOVERY_BASE_DELAY_MS,
    1_000,
    'MULTIAGENT_STALE_RECOVERY_BASE_DELAY_MS',
  )
  const langfuseBaseUrl = parseOptionalString(raw.LANGFUSE_BASE_URL)
  const langfusePublicKey = parseOptionalString(raw.LANGFUSE_PUBLIC_KEY)
  const langfuseSecretKey = parseOptionalString(raw.LANGFUSE_SECRET_KEY)
  const langfuseConfigured =
    typeof langfuseBaseUrl === 'string' &&
    typeof langfusePublicKey === 'string' &&
    typeof langfuseSecretKey === 'string'
  const langfuseEnabled = parseBoolean(raw.LANGFUSE_ENABLED, langfuseConfigured, 'LANGFUSE_ENABLED')
  const langfuseTimeoutMs = parseInteger(raw.LANGFUSE_TIMEOUT_MS, 10_000, 'LANGFUSE_TIMEOUT_MS')
  const langfuseEnvironment = raw.LANGFUSE_ENVIRONMENT?.trim() || nodeEnv
  const multiagentWorkerAutoStart = parseBoolean(
    raw.MULTIAGENT_WORKER_AUTO_START,
    nodeEnv !== 'test',
    'MULTIAGENT_WORKER_AUTO_START',
  )
  const gardenWorkerAutoStart = parseBoolean(
    raw.GARDEN_WORKER_AUTO_START,
    nodeEnv !== 'test',
    'GARDEN_WORKER_AUTO_START',
  )
  const agentTaskWorkerAutoStart = parseBoolean(
    raw.AGENT_TASK_WORKER_AUTO_START,
    nodeEnv !== 'test',
    'AGENT_TASK_WORKER_AUTO_START',
  )
  const agentTaskWorkerPollIntervalMs = parseInteger(
    raw.AGENT_TASK_WORKER_POLL_MS,
    15_000,
    'AGENT_TASK_WORKER_POLL_MS',
  )
  const agentTaskWorkerBatchSize = parseInteger(
    raw.AGENT_TASK_WORKER_BATCH_SIZE,
    10,
    'AGENT_TASK_WORKER_BATCH_SIZE',
  )
  const kernelEnabled = parseBoolean(raw.KERNEL_ENABLED, false, 'KERNEL_ENABLED')
  const kernelProvider = kernelProviderSchema.parse(raw.KERNEL_PROVIDER ?? 'local')
  const kernelLocalCdpUrl = parseUrl(raw.KERNEL_CDP_URL, 'http://127.0.0.1:9222', 'KERNEL_CDP_URL')
  const kernelLocalApiUrl = parseUrl(
    raw.KERNEL_LOCAL_API_URL,
    'http://127.0.0.1:10001',
    'KERNEL_LOCAL_API_URL',
  )
  const kernelCloudApiUrl = parseUrl(raw.KERNEL_API_URL, 'https://api.kernel.sh', 'KERNEL_API_URL')
  const kernelCloudApiKey = parseOptionalString(raw.KERNEL_API_KEY)
  const sandboxProvider = sandboxProviderSchema.parse(raw.SANDBOX_PROVIDER ?? 'local_dev')
  const sandboxLoBinary = parseOptionalString(raw.SANDBOX_LO_BINARY)
  const sandboxLoBootstrapEntry = parseOptionalString(raw.SANDBOX_LO_BOOTSTRAP_ENTRY)
  const eventStreamMaxFollowMs = parseInteger(
    raw.EVENT_STREAM_MAX_FOLLOW_MS,
    5 * 60 * 1000,
    'EVENT_STREAM_MAX_FOLLOW_MS',
  )
  const aiModelRegistry: AiModelRegistry = {
    aliases: {
      default: {
        model: defaultAiModel,
        provider: defaultAiProvider,
      },
      'gemini-3.1-pro': {
        model: 'gemini-3.1-pro-preview',
        provider: 'google',
      },
      'gemini-3.1-flash-lite': {
        model: 'gemini-3.1-flash-lite-preview',
        provider: 'google',
      },
      'gemini-3.5-flash': {
        model: 'gemini-3.5-flash',
        provider: 'google',
      },
      'gpt-5.6': {
        model: 'gpt-5.6-sol',
        provider: 'openai',
      },
      google_default: {
        model: googleDefaultModel,
        provider: 'google',
      },
      openai_default: {
        model: openAiDefaultModel,
        provider: 'openai',
      },
      openrouter_default: {
        model: openRouterDefaultModel,
        provider: 'openrouter',
      },
    },
    defaultAlias: 'default',
  }
  const aiImageModelRegistry: AiImageModelRegistry = {
    aliases: {
      google_default_edit: {
        model: googleImageDefaultModel,
        provider: 'google',
      },
      google_default_generate: {
        model: googleImageDefaultModel,
        provider: 'google',
      },
      nano_banana_2_edit: {
        model: 'gemini-3.1-flash-image',
        provider: 'google',
      },
      nano_banana_2_generate: {
        model: 'gemini-3.1-flash-image',
        provider: 'google',
      },
      openai_default_edit: {
        model: openAiImageDefaultModel,
        provider: 'openai',
      },
      openai_default_generate: {
        model: openAiImageDefaultModel,
        provider: 'openai',
      },
      openrouter_default_edit: {
        model: openRouterImageDefaultModel,
        provider: 'openrouter',
      },
      openrouter_default_generate: {
        model: openRouterImageDefaultModel,
        provider: 'openrouter',
      },
    },
    defaultAliases: {
      edit: defaultImageProviderAlias ? `${defaultImageProviderAlias}_default_edit` : null,
      generate: defaultImageProviderAlias ? `${defaultImageProviderAlias}_default_generate` : null,
    },
  }

  if (allowOrigins.includes('*') && allowCredentials) {
    throw new Error('CORS_ALLOW_ORIGINS cannot include "*" when CORS_ALLOW_CREDENTIALS=true')
  }

  if (authSessionCookieName.startsWith('__Host-') && !authSessionSecure) {
    throw new Error(
      'AUTH_SESSION_COOKIE_NAME with "__Host-" prefix requires AUTH_SESSION_SECURE=true',
    )
  }

  if (langfuseEnabled && !langfuseConfigured) {
    throw new Error(
      'LANGFUSE_ENABLED=true requires LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY',
    )
  }

  if (kernelEnabled && kernelProvider === 'cloud' && !kernelCloudApiKey) {
    throw new Error('KERNEL_PROVIDER=cloud requires KERNEL_API_KEY when KERNEL_ENABLED=true')
  }

  return {
    api: {
      basePath,
      cors: {
        allowCredentials,
        allowHeaders: parseCsv(raw.CORS_ALLOW_HEADERS, defaultCorsHeaders),
        allowMethods: parseCsv(raw.CORS_ALLOW_METHODS, defaultCorsMethods),
        allowOrigins,
        exposeHeaders: parseCsv(raw.CORS_EXPOSE_HEADERS, defaultCorsExposeHeaders),
        maxAgeSeconds: parseInteger(raw.CORS_MAX_AGE_SECONDS, 600, 'CORS_MAX_AGE_SECONDS'),
      },
      maxRequestBodyBytes,
      version: 'v1',
    },
    ai: {
      imageModelRegistry: aiImageModelRegistry,
      defaults: {
        maxRetries: aiMaxRetries,
        model: defaultAiModel,
        provider: defaultAiProvider,
        timeoutMs: aiTimeoutMs,
      },
      modelRegistry: aiModelRegistry,
      providers: {
        google: {
          apiKey: parseOptionalString(raw.GOOGLE_API_KEY),
          apiVersion: parseOptionalString(raw.GOOGLE_API_VERSION),
          baseUrl: parseOptionalString(raw.GOOGLE_BASE_URL),
          defaultModel: googleDefaultModel,
          imageDefaultModel: googleImageDefaultModel,
          location: parseOptionalString(raw.GOOGLE_CLOUD_LOCATION),
          project: parseOptionalString(raw.GOOGLE_CLOUD_PROJECT),
          vertexai: parseBoolean(raw.GOOGLE_VERTEXAI, false, 'GOOGLE_VERTEXAI'),
        },
        openai: {
          apiKey: parseOptionalString(raw.OPENAI_API_KEY),
          baseUrl: parseOptionalString(raw.OPENAI_BASE_URL),
          defaultModel: openAiDefaultModel,
          imageDefaultModel: openAiImageDefaultModel,
          organization: parseOptionalString(raw.OPENAI_ORGANIZATION),
          project: parseOptionalString(raw.OPENAI_PROJECT_ID),
          serviceTier: raw.OPENAI_SERVICE_TIER
            ? openAiServiceTierSchema.parse(raw.OPENAI_SERVICE_TIER)
            : null,
          webhookSecret: parseOptionalString(raw.OPENAI_WEBHOOK_SECRET),
        },
        openrouter: {
          apiKey: parseOptionalString(raw.OPENROUTER_API_KEY),
          appCategories: parseOptionalString(raw.OPENROUTER_APP_CATEGORIES),
          appTitle: parseOptionalString(raw.OPENROUTER_APP_TITLE),
          baseUrl: parseOptionalString(raw.OPENROUTER_BASE_URL),
          defaultModel: openRouterDefaultModel,
          imageDefaultModel: openRouterImageDefaultModel,
          httpReferer: parseOptionalString(raw.OPENROUTER_HTTP_REFERER),
        },
      },
    },
    files: {
      allowedMimeTypes: parseCsv(raw.FILE_ALLOWED_MIME_TYPES, [
        'image/*',
        'text/*',
        'application/pdf',
      ]),
      inlineTextBytes: parseInteger(raw.FILE_INLINE_TEXT_BYTES, 65_536, 'FILE_INLINE_TEXT_BYTES'),
      maxUploadBytes: fileMaxUploadBytes,
      storage: {
        kind: fileStorageKindSchema.parse(raw.FILE_STORAGE_KIND ?? 'local'),
        root: resolve(process.cwd(), raw.FILE_STORAGE_ROOT ?? './var/files'),
      },
    },
    auth: {
      methods: authMethods,
      mode: authMode,
      session: {
        cookieName: authSessionCookieName,
        maxAgeSeconds: authSessionMaxAgeSeconds,
        sameSite: authSessionSameSite,
        secure: authSessionSecure,
      },
    },
    agentTasks: {
      worker: {
        autoStart: agentTaskWorkerAutoStart,
        batchSize: agentTaskWorkerBatchSize,
        pollIntervalMs: agentTaskWorkerPollIntervalMs,
      },
    },
    app: {
      env: nodeEnv,
      name: '05_04_api',
    },
    database: {
      path: resolve(process.cwd(), raw.DATABASE_PATH ?? './var/05_04_api.sqlite'),
    },
    garden: {
      worker: {
        autoStart: gardenWorkerAutoStart,
        debounceWindowMs: gardenWorkerDebounceWindowMs,
        pollIntervalMs: gardenWorkerPollIntervalMs,
      },
    },
    kernel: {
      cloud: {
        apiKey: kernelCloudApiKey,
        apiUrl: kernelCloudApiUrl,
      },
      enabled: kernelEnabled,
      local: {
        apiUrl: kernelLocalApiUrl,
        cdpUrl: kernelLocalCdpUrl,
      },
      provider: kernelProvider,
    },
    mcp: {
      secretEncryptionKey: parseOptionalString(raw.MCP_SECRET_ENCRYPTION_KEY),
      servers: resolveMcpServers(raw.MCP_SERVERS_FILE, env),
    },
    memory: {
      compaction: {
        rawItemThreshold: memoryRawItemThreshold,
        tailRatio: memoryObservationTailRatio,
        triggerRatio: memoryObservationTriggerRatio,
      },
      reflection: {
        triggerRatio: memoryReflectionTriggerRatio,
      },
    },
    multiagent: {
      leaseTtlMs: multiagentLeaseTtlMs,
      maxRunTurns: multiagentMaxRunTurns,
      maxStaleRecoveries: multiagentMaxStaleRecoveries,
      profile: multiagentRuntimeProfileSchema.parse('single_process'),
      staleRecoveryBaseDelayMs: multiagentStaleRecoveryBaseDelayMs,
      worker: {
        autoStart: multiagentWorkerAutoStart,
        pollIntervalMs: multiagentWorkerPollIntervalMs,
      },
    },
    observability: {
      langfuse: {
        baseUrl: langfuseBaseUrl,
        enabled: langfuseEnabled,
        environment: langfuseEnvironment,
        publicKey: langfusePublicKey,
        secretKey: langfuseSecretKey,
        timeoutMs: langfuseTimeoutMs,
      },
      logLevel,
    },
    sandbox: {
      lo: {
        binaryPath: sandboxLoBinary ? resolve(process.cwd(), sandboxLoBinary) : null,
        bootstrapEntry: sandboxLoBootstrapEntry
          ? resolve(process.cwd(), sandboxLoBootstrapEntry)
          : null,
      },
      provider: sandboxProvider,
    },
    server: {
      eventStreamMaxFollowMs,
      host,
      port,
    },
  }
}
