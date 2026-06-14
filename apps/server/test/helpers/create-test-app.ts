import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../src/app/config'
import { createApp } from '../../src/app/create-app'
import { createAppRuntime, initializeAppRuntime } from '../../src/app/runtime'
import { flattenReasoningSummaryText } from '../../src/domain/ai/reasoning-summary'
import { ok } from '../../src/shared/result'

const toTestConfig = (dir: string, env: NodeJS.ProcessEnv = {}) => {
  const mcpServersFilePath = join(dir, 'mcp-servers.json')
  writeFileSync(mcpServersFilePath, '[]', 'utf8')

  return loadConfig({
    ...process.env,
    DATABASE_PATH: join(dir, 'test.sqlite'),
    FILE_STORAGE_ROOT: join(dir, 'files'),
    LOG_LEVEL: 'error',
    MCP_SERVERS_FILE: mcpServersFilePath,
    NODE_ENV: 'test',
    ...env,
  })
}

const wireStreamingStub = (runtime: ReturnType<typeof createAppRuntime>) => {
  runtime.services.ai.interactions.stream = async (request) => {
    const generated = await runtime.services.ai.interactions.generate(request)

    if (!generated.ok) {
      return generated
    }

    return ok(
      (async function* () {
        yield {
          model: generated.value.model,
          provider: generated.value.provider,
          responseId: generated.value.responseId,
          type: 'response.started' as const,
        }

        for (const outputItem of generated.value.output) {
          if (outputItem.type === 'reasoning') {
            const text =
              typeof outputItem.text === 'string' && outputItem.text.trim().length > 0
                ? outputItem.text.trim()
                : flattenReasoningSummaryText(outputItem.summary)

            if (text.length > 0) {
              yield {
                itemId: outputItem.id,
                text,
                type: 'reasoning.summary.done' as const,
              }
            }
            continue
          }

          if (outputItem.type === 'function_call') {
            const { type: _type, ...call } = outputItem
            yield {
              call,
              type: 'tool.call' as const,
            }
            continue
          }

          if (outputItem.type === 'message') {
            const messageText = outputItem.content
              .flatMap((part) => (part.type === 'text' ? [part.text] : []))
              .join('\n\n')
              .trim()

            if (messageText.length > 0) {
              yield {
                delta: messageText,
                type: 'text.delta' as const,
              }
            }
          }
        }

        for (const activity of generated.value.webSearches ?? []) {
          yield {
            activity,
            type: 'web_search' as const,
          }
        }

        yield {
          response: generated.value,
          type: 'response.completed' as const,
        }
      })(),
    )
  }
}

export const createTestHarness = (env: NodeJS.ProcessEnv = {}) => {
  const dir = mkdtempSync(join(tmpdir(), '05_04_api-test-'))
  const config = toTestConfig(dir, env)
  const runtime = createAppRuntime(config)

  wireStreamingStub(runtime)

  return {
    app: createApp(runtime),
    config,
    runtime,
  }
}

export const createTestApp = (env: NodeJS.ProcessEnv = {}) => createTestHarness(env).app

export const createAsyncTestHarness = async (env: NodeJS.ProcessEnv = {}) => {
  const dir = mkdtempSync(join(tmpdir(), '05_04_api-test-'))
  const config = toTestConfig(dir, env)
  const runtime = await initializeAppRuntime(createAppRuntime(config))

  wireStreamingStub(runtime)

  return {
    app: createApp(runtime),
    config,
    runtime,
  }
}
