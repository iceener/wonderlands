import type { ToolRegistry, ToolSpec } from '../../domain/tooling/tool-registry'
import { ok } from '../../shared/result'
import { isNativeToolAllowedForRun } from '../agents/agent-runtime-policy'
import type { createKernelBrowserService } from './kernel-browser-service'
import { type RunBrowserJobArgs, validateRunBrowserJobArgs } from './kernel-policy'

export const registerKernelNativeTools = (
  toolRegistry: ToolRegistry,
  input: {
    browser: ReturnType<typeof createKernelBrowserService>
    db: Parameters<typeof isNativeToolAllowedForRun>[0]
  },
): void => {
  const runBrowserJobTool: ToolSpec = {
    attachmentRefResolutionPolicy: 'smart_default',
    description:
      'Run a short-lived browser automation job in Kernel using a Playwright-compatible script. The script runs with `page`, `context`, and `browser` arguments. Use it for navigation, interaction, scraping, screenshots, DOM capture, cookies export, and PDF generation. Return JSON-serializable data from the script instead of printing it. Requested browser artifacts are persisted as conversation attachments automatically.',
    domain: 'native',
    execute: async (context, rawArgs) => {
      const args = rawArgs as RunBrowserJobArgs
      const result = await input.browser.runBrowserJob(context, args)

      return result.ok
        ? ok({
            kind: 'immediate' as const,
            output: result.value,
          })
        : result
    },
    inputSchema: {
      additionalProperties: false,
      properties: {
        outputs: {
          additionalProperties: false,
          properties: {
            console: {
              description: 'Include browser and script console output in the tool response.',
              type: 'boolean',
            },
            cookies: {
              description: 'Persist the final browser cookies as a JSON attachment.',
              type: 'boolean',
            },
            html: {
              anyOf: [
                { type: 'boolean' },
                {
                  additionalProperties: false,
                  properties: {
                    selector: {
                      description:
                        'Optional selector to capture only a specific element outerHTML.',
                      type: 'string',
                    },
                  },
                  type: 'object',
                },
              ],
            },
            pdf: {
              description: 'Persist a PDF render of the final page.',
              type: 'boolean',
            },
            recording: {
              description: 'Record the browser session and attach the resulting MP4 file.',
              type: 'boolean',
            },
            screenshot: {
              anyOf: [
                { type: 'boolean' },
                {
                  additionalProperties: false,
                  properties: {
                    fullPage: {
                      description: 'Capture a full-page screenshot instead of the viewport.',
                      type: 'boolean',
                    },
                    selector: {
                      description:
                        'Optional selector to capture only a specific element screenshot.',
                      type: 'string',
                    },
                  },
                  type: 'object',
                },
              ],
            },
          },
          type: 'object',
        },
        script: {
          description:
            'Playwright-compatible JavaScript or TypeScript. It is executed with `page`, `context`, and `browser` arguments. Return JSON-serializable data.',
          type: 'string',
        },
        task: {
          description: 'Short description of what the browser job is trying to accomplish.',
          type: 'string',
        },
        timeoutSec: {
          description: 'Optional execution timeout in seconds.',
          minimum: 1,
          maximum: 300,
          type: 'integer',
        },
        url: {
          description: 'Optional initial URL to open before the script runs.',
          format: 'uri',
          type: 'string',
        },
        viewport: {
          additionalProperties: false,
          properties: {
            height: {
              minimum: 1,
              type: 'integer',
            },
            width: {
              minimum: 1,
              type: 'integer',
            },
          },
          type: 'object',
        },
      },
      required: ['script', 'task'],
      type: 'object',
    },
    isAvailable: (context) => {
      const adapter = context.services.kernel.getAdapter()

      return (
        Boolean(context.run.agentRevisionId) &&
        context.services.kernel.getAvailability().available &&
        Boolean(adapter?.supportsBrowserJobs) &&
        isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'browse')
      )
    },
    name: 'browse',
    strict: true,
    validateArgs: (args) => validateRunBrowserJobArgs(args),
  }

  toolRegistry.register(runBrowserJobTool)
}
