import assert from 'node:assert/strict'
import { test } from 'vitest'

import { loadConfig } from '../src/app/config'

test('loadConfig provides defaults without requiring .env', () => {
  const config = loadConfig({})

  assert.equal(config.api.basePath, '/api')
  assert.equal(config.ai.defaults.provider, 'openai')
  assert.equal(config.ai.defaults.model, 'gpt-5.4')
  assert.equal(config.ai.modelRegistry.aliases.google_default.model, 'gemini-3.1-pro-preview')
  assert.equal(config.ai.providers.google.imageDefaultModel, 'gemini-3.1-flash-image-preview')
  assert.equal(config.ai.imageModelRegistry.defaultAliases.generate, null)
  assert.equal(config.ai.imageModelRegistry.defaultAliases.edit, null)
  assert.equal(config.ai.defaults.timeoutMs, 60_000)
  assert.equal(config.memory.compaction.triggerRatio, 0.3)
  assert.equal(config.memory.compaction.tailRatio, 0.3)
  assert.equal(config.memory.reflection.triggerRatio, 0.6)
  assert.equal(config.multiagent.maxStaleRecoveries, 5)
  assert.equal(config.multiagent.staleRecoveryBaseDelayMs, 1_000)
  assert.equal(config.observability.langfuse.enabled, false)
  assert.equal(config.observability.langfuse.environment, 'development')
  assert.equal(config.server.host, '127.0.0.1')
  assert.equal(config.server.port, 3000)
  assert.equal(config.kernel.enabled, false)
  assert.equal(config.kernel.provider, 'local')
  assert.equal(config.kernel.local.apiUrl, 'http://127.0.0.1:10001/')
  assert.equal(config.kernel.local.cdpUrl, 'http://127.0.0.1:9222/')
  assert.equal(config.kernel.cloud.apiUrl, 'https://api.kernel.sh/')
  assert.match(config.database.path, /05_04_api\.sqlite$/)
})

test('loadConfig enables Gemini image generation defaults when Google is configured', () => {
  const config = loadConfig({
    GOOGLE_API_KEY: 'google-test-key',
    NODE_ENV: 'test',
  })

  assert.equal(config.ai.providers.google.imageDefaultModel, 'gemini-3.1-flash-image-preview')
  assert.equal(config.ai.imageModelRegistry.defaultAliases.edit, 'google_default_edit')
  assert.equal(config.ai.imageModelRegistry.defaultAliases.generate, 'google_default_generate')
  assert.equal(
    config.ai.imageModelRegistry.aliases.google_default_edit.model,
    'gemini-3.1-flash-image-preview',
  )
  assert.equal(
    config.ai.imageModelRegistry.aliases.google_default_generate.model,
    'gemini-3.1-flash-image-preview',
  )
})

test('loadConfig falls back to OpenAI image defaults when Google is not configured', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    OPENAI_API_KEY: 'openai-test-key',
  })

  assert.equal(config.ai.providers.openai.imageDefaultModel, 'gpt-image-1.5')
  assert.equal(config.ai.imageModelRegistry.defaultAliases.edit, 'openai_default_edit')
  assert.equal(config.ai.imageModelRegistry.defaultAliases.generate, 'openai_default_generate')
})

test('loadConfig falls back to OpenRouter image defaults when only OpenRouter is configured', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    OPENROUTER_API_KEY: 'openrouter-test-key',
  })

  assert.equal(
    config.ai.providers.openrouter.imageDefaultModel,
    'google/gemini-3.1-flash-image-preview',
  )
  assert.equal(config.ai.imageModelRegistry.defaultAliases.edit, 'openrouter_default_edit')
  assert.equal(config.ai.imageModelRegistry.defaultAliases.generate, 'openrouter_default_generate')
})

test('loadConfig rejects wildcard origins when credentials are enabled', () => {
  assert.throws(
    () =>
      loadConfig({
        CORS_ALLOW_CREDENTIALS: 'true',
        CORS_ALLOW_ORIGINS: '*',
      }),
    /cannot include "\*" when CORS_ALLOW_CREDENTIALS=true/,
  )
})

test('loadConfig defaults production auth mode to api_key', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
  })

  assert.equal(config.auth.mode, 'api_key')
  assert.deepEqual(config.auth.methods, ['api_key', 'auth_session'])
})

test('loadConfig allows auth session and api key auth to coexist when AUTH_METHODS is set', () => {
  const config = loadConfig({
    AUTH_METHODS: 'auth_session, api_key',
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  assert.equal(config.auth.mode, 'api_key')
  assert.deepEqual(config.auth.methods, ['auth_session', 'api_key'])
  assert.equal(config.auth.session.cookieName, '05_04_session')
})

test('loadConfig enables Langfuse when credentials are configured', () => {
  const config = loadConfig({
    LANGFUSE_BASE_URL: 'https://langfuse.local',
    LANGFUSE_PUBLIC_KEY: 'pk_test',
    LANGFUSE_SECRET_KEY: 'sk_test',
    NODE_ENV: 'test',
  })

  assert.equal(config.observability.langfuse.enabled, true)
  assert.equal(config.observability.langfuse.baseUrl, 'https://langfuse.local')
  assert.equal(config.observability.langfuse.environment, 'test')
})

test('loadConfig rejects explicit Langfuse enablement without credentials', () => {
  assert.throws(
    () =>
      loadConfig({
        LANGFUSE_ENABLED: 'true',
        NODE_ENV: 'test',
      }),
    /LANGFUSE_ENABLED=true requires LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY/,
  )
})

test('loadConfig requires a Kernel API key when cloud mode is enabled', () => {
  assert.throws(
    () =>
      loadConfig({
        KERNEL_ENABLED: 'true',
        KERNEL_PROVIDER: 'cloud',
        NODE_ENV: 'test',
      }),
    /KERNEL_PROVIDER=cloud requires KERNEL_API_KEY when KERNEL_ENABLED=true/,
  )
})

test('loadConfig accepts a custom API base path that does not collide with root routes', () => {
  const config = loadConfig({
    API_BASE_PATH: '/internal-api',
    NODE_ENV: 'test',
  })

  assert.equal(config.api.basePath, '/internal-api')
})

test('loadConfig rejects API_BASE_PATH=/', () => {
  assert.throws(
    () =>
      loadConfig({
        API_BASE_PATH: '/',
        NODE_ENV: 'test',
      }),
    /API_BASE_PATH must not be "\/"/,
  )
})

test('loadConfig rejects API base paths that shadow root-owned routes', () => {
  assert.throws(
    () =>
      loadConfig({
        API_BASE_PATH: '/status',
        NODE_ENV: 'test',
      }),
    /API_BASE_PATH must not shadow root-owned routes: \/status, \/_auth/,
  )

  assert.throws(
    () =>
      loadConfig({
        API_BASE_PATH: '/_auth/callbacks',
        NODE_ENV: 'test',
      }),
    /API_BASE_PATH must not shadow root-owned routes: \/status, \/_auth/,
  )
})
