import { createAgentRevisionRepository } from '../../domain/agents/agent-revision-repository'
import {
  createKernelSessionRepository,
  type KernelSessionRecord,
} from '../../domain/kernel/kernel-session-repository'
import type { KernelArtifactKind, KernelPolicy } from '../../domain/kernel/types'
import type { ToolContext } from '../../domain/tooling/tool-registry'
import type { DomainError } from '../../shared/errors'
import { asKernelSessionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { createKernelArtifactService, PersistKernelArtifactInput } from './kernel-artifacts'
import {
  parseKernelPolicyJson,
  type RunBrowserJobArgs,
  validateKernelBrowserRequest,
} from './kernel-policy'

export interface BrowserJobArtifactSummary {
  fileId: string
  kind: KernelArtifactKind
  mimeType: string | null
  name: string
  sizeBytes: number | null
}

export interface BrowserJobResult {
  artifacts: BrowserJobArtifactSummary[]
  consoleOutput: string | null
  durationMs: number
  kernelSessionId: string
  page: {
    title: string | null
    url: string | null
  }
  result: unknown
  status: 'completed'
}

export interface KernelBrowserService {
  runBrowserJob: (
    context: ToolContext,
    args: RunBrowserJobArgs,
  ) => Promise<Result<BrowserJobResult, DomainError>>
}

interface BrowserExecutionArtifactPayload {
  base64Data?: string
  filename: string
  metadata?: Record<string, unknown> | null
  mimeType: string
  text?: string
}

interface BrowserExecutionPayload {
  artifacts: {
    cookies?: BrowserExecutionArtifactPayload
    html?: BrowserExecutionArtifactPayload
    pdf?: BrowserExecutionArtifactPayload
    screenshot?: BrowserExecutionArtifactPayload
  }
  consoleMessages: string[]
  page: {
    title: string | null
    url: string | null
  }
  userResult: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toDurationMs = (startedAt: string, completedAt: string): number => {
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0
  }

  return Math.max(0, end - start)
}

const toConflictError = (message: string): Result<never, DomainError> =>
  err({
    message,
    type: 'conflict',
  })

const toProviderError = (message: string): Result<never, DomainError> =>
  err({
    message,
    provider: 'kernel_local',
    retryable: false,
    type: 'provider',
  })

const detectFailedStatus = (message: string): KernelSessionRecord['status'] =>
  /timed out/i.test(message) ? 'timeout' : 'failed'

const toJsonRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

const encodeScript = (script: string): string => JSON.stringify(script)

const buildBrowserExecutionCode = (input: {
  args: {
    outputs: {
      console: boolean
      cookies: boolean
      html: null | { selector: string | null }
      pdf: boolean
      screenshot: null | { fullPage: boolean; selector: string | null }
    }
    script: string
    url: string | null
    viewport: { height: number; width: number }
  }
  policy: KernelPolicy
}): string => {
  const payload = JSON.stringify({
    network: input.policy.network,
    outputs: input.args.outputs,
    script: input.args.script,
    url: input.args.url,
    viewport: input.args.viewport,
  })

  return `
const __wonderlandsInput = ${payload};
const __wonderlandsConsoleMessages: string[] = [];
const __wonderlandsMatchesHost = (host: string, candidate: string) =>
  host === candidate || host.endsWith(\`.\${candidate}\`);
const __wonderlandsSerialize = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => __wonderlandsSerialize(item, seen));
  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = __wonderlandsSerialize(item, seen);
    }
    seen.delete(value as object);
    return out;
  }
  return String(value);
};
const __wonderlandsFormatArgs = (args: unknown[]) =>
  args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(__wonderlandsSerialize(arg));
    } catch {
      return String(arg);
    }
  }).join(' ');

const __wonderlandsContext = await browser.newContext({
  viewport: {
    height: __wonderlandsInput.viewport.height,
    width: __wonderlandsInput.viewport.width,
  },
});
const __wonderlandsPage = await __wonderlandsContext.newPage();

await __wonderlandsContext.route('**/*', async (route) => {
  const requestUrl = route.request().url();
  let parsed: URL | null = null;
  try {
    parsed = new URL(requestUrl);
  } catch {
    parsed = null;
  }

  const protocol = parsed?.protocol ?? '';
  const host = parsed?.hostname?.toLowerCase() ?? '';

  if (protocol === 'http:' || protocol === 'https:') {
    const blocked = __wonderlandsInput.network.blockedHosts.some((candidate: string) =>
      __wonderlandsMatchesHost(host, String(candidate).toLowerCase()),
    );

    if (blocked) {
      await route.abort();
      return;
    }

    if (__wonderlandsInput.network.mode === 'off') {
      await route.abort();
      return;
    }

    if (
      __wonderlandsInput.network.mode === 'allow_list' &&
      !__wonderlandsInput.network.allowedHosts.some((candidate: string) =>
        __wonderlandsMatchesHost(host, String(candidate).toLowerCase()),
      )
    ) {
      await route.abort();
      return;
    }
  }

  await route.continue();
});

__wonderlandsPage.on('console', (message) => {
  __wonderlandsConsoleMessages.push(\`[page:\${message.type()}] \${message.text()}\`);
});

const __wonderlandsOriginalConsole = {
  error: console.error,
  info: console.info,
  log: console.log,
  warn: console.warn,
};
console.log = (...args) => {
  __wonderlandsConsoleMessages.push(\`[log] \${__wonderlandsFormatArgs(args)}\`);
};
console.info = (...args) => {
  __wonderlandsConsoleMessages.push(\`[info] \${__wonderlandsFormatArgs(args)}\`);
};
console.warn = (...args) => {
  __wonderlandsConsoleMessages.push(\`[warn] \${__wonderlandsFormatArgs(args)}\`);
};
console.error = (...args) => {
  __wonderlandsConsoleMessages.push(\`[error] \${__wonderlandsFormatArgs(args)}\`);
};

try {
  if (__wonderlandsInput.url) {
    await __wonderlandsPage.goto(__wonderlandsInput.url, { waitUntil: 'domcontentloaded' });
  }

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const __wonderlandsUserFunction = new AsyncFunction(
    'page',
    'context',
    'browser',
    ${encodeScript(input.args.script)},
  );
  const __wonderlandsUserResult = await __wonderlandsUserFunction(
    __wonderlandsPage,
    __wonderlandsContext,
    browser,
  );
  const __wonderlandsArtifacts: Record<string, unknown> = {};

  if (__wonderlandsInput.outputs.screenshot) {
    const screenshot = __wonderlandsInput.outputs.screenshot;
    if (screenshot.selector) {
      const locator = __wonderlandsPage.locator(screenshot.selector).first();
      const buffer = await locator.screenshot();
      __wonderlandsArtifacts.screenshot = {
        base64Data: buffer.toString('base64'),
        filename: 'browser-screenshot.png',
        metadata: { selector: screenshot.selector },
        mimeType: 'image/png',
      };
    } else {
      const buffer = await __wonderlandsPage.screenshot({ fullPage: Boolean(screenshot.fullPage) });
      __wonderlandsArtifacts.screenshot = {
        base64Data: buffer.toString('base64'),
        filename: 'browser-screenshot.png',
        metadata: { fullPage: Boolean(screenshot.fullPage) },
        mimeType: 'image/png',
      };
    }
  }

  if (__wonderlandsInput.outputs.html) {
    const html = __wonderlandsInput.outputs.html.selector
      ? await __wonderlandsPage
          .locator(__wonderlandsInput.outputs.html.selector)
          .first()
          .evaluate((element) => (element as HTMLElement).outerHTML)
      : await __wonderlandsPage.content();
    __wonderlandsArtifacts.html = {
      filename: 'browser-dom.html',
      metadata: { selector: __wonderlandsInput.outputs.html.selector ?? null },
      mimeType: 'text/html',
      text: html,
    };
  }

  if (__wonderlandsInput.outputs.pdf) {
    const buffer = await __wonderlandsPage.pdf({ printBackground: true });
    __wonderlandsArtifacts.pdf = {
      base64Data: buffer.toString('base64'),
      filename: 'browser-page.pdf',
      mimeType: 'application/pdf',
    };
  }

  if (__wonderlandsInput.outputs.cookies) {
    const cookies = await __wonderlandsContext.cookies();
    __wonderlandsArtifacts.cookies = {
      filename: 'browser-cookies.json',
      mimeType: 'application/json',
      text: JSON.stringify(cookies, null, 2),
    };
  }

  let title: string | null = null;
  try {
    title = await __wonderlandsPage.title();
  } catch {
    title = null;
  }

  return {
    artifacts: __wonderlandsArtifacts,
    consoleMessages: __wonderlandsConsoleMessages,
    page: {
      title,
      url: __wonderlandsPage.url() || null,
    },
    userResult: __wonderlandsSerialize(__wonderlandsUserResult),
  };
} finally {
  console.log = __wonderlandsOriginalConsole.log;
  console.info = __wonderlandsOriginalConsole.info;
  console.warn = __wonderlandsOriginalConsole.warn;
  console.error = __wonderlandsOriginalConsole.error;
  await __wonderlandsContext.close().catch(() => undefined);
}
`.trim()
}

const parseArtifactPayload = (
  value: unknown,
): Result<BrowserExecutionArtifactPayload | null, DomainError> => {
  if (value === undefined) {
    return ok(null)
  }

  if (!isRecord(value)) {
    return toProviderError('Kernel browser execution returned an invalid artifact payload')
  }

  if (typeof value.filename !== 'string' || typeof value.mimeType !== 'string') {
    return toProviderError(
      'Kernel browser execution artifact payload is missing filename or mimeType',
    )
  }

  if (value.base64Data !== undefined && typeof value.base64Data !== 'string') {
    return toProviderError('Kernel browser execution artifact base64Data must be a string')
  }

  if (value.text !== undefined && typeof value.text !== 'string') {
    return toProviderError('Kernel browser execution artifact text must be a string')
  }

  return ok({
    base64Data: typeof value.base64Data === 'string' ? value.base64Data : undefined,
    filename: value.filename,
    metadata: isRecord(value.metadata) ? value.metadata : null,
    mimeType: value.mimeType,
    text: typeof value.text === 'string' ? value.text : undefined,
  })
}

const parseExecutionPayload = (value: unknown): Result<BrowserExecutionPayload, DomainError> => {
  if (!isRecord(value)) {
    return toProviderError('Kernel browser execution returned a non-object payload')
  }

  const artifactsRecord = isRecord(value.artifacts) ? value.artifacts : {}
  const screenshot = parseArtifactPayload(artifactsRecord.screenshot)
  const html = parseArtifactPayload(artifactsRecord.html)
  const pdf = parseArtifactPayload(artifactsRecord.pdf)
  const cookies = parseArtifactPayload(artifactsRecord.cookies)

  if (!screenshot.ok) {
    return screenshot
  }
  if (!html.ok) {
    return html
  }
  if (!pdf.ok) {
    return pdf
  }
  if (!cookies.ok) {
    return cookies
  }

  return ok({
    artifacts: {
      ...(cookies.value ? { cookies: cookies.value } : {}),
      ...(html.value ? { html: html.value } : {}),
      ...(pdf.value ? { pdf: pdf.value } : {}),
      ...(screenshot.value ? { screenshot: screenshot.value } : {}),
    },
    consoleMessages: Array.isArray(value.consoleMessages)
      ? value.consoleMessages.filter((entry): entry is string => typeof entry === 'string')
      : [],
    page: {
      title:
        isRecord(value.page) && (typeof value.page.title === 'string' || value.page.title === null)
          ? value.page.title
          : null,
      url:
        isRecord(value.page) && (typeof value.page.url === 'string' || value.page.url === null)
          ? value.page.url
          : null,
    },
    userResult: value.userResult ?? null,
  })
}

const toArtifactBody = (
  kind: Exclude<KernelArtifactKind, 'recording'>,
  artifact: BrowserExecutionArtifactPayload | undefined,
): Result<PersistKernelArtifactInput | null, DomainError> => {
  if (!artifact) {
    return ok(null)
  }

  if (typeof artifact.base64Data === 'string') {
    return ok({
      body: new Uint8Array(Buffer.from(artifact.base64Data, 'base64')),
      filename: artifact.filename,
      kind,
      metadata: artifact.metadata ?? undefined,
      mimeType: artifact.mimeType,
    })
  }

  if (typeof artifact.text === 'string') {
    return ok({
      body: new TextEncoder().encode(artifact.text),
      filename: artifact.filename,
      kind,
      metadata: artifact.metadata ?? undefined,
      mimeType: artifact.mimeType,
    })
  }

  return toProviderError(`Kernel browser execution artifact ${kind} did not include body data`)
}

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const readStatusCode = (error: DomainError): number | null =>
  error.type === 'provider' ? (error.statusCode ?? null) : null

const downloadRecordingWithRetry = async (
  context: ToolContext,
  recordingId: string,
): Promise<Result<PersistKernelArtifactInput, DomainError>> => {
  const adapter = context.services.kernel.getAdapter()

  if (!adapter) {
    return toConflictError('Kernel adapter is not available')
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const downloaded = await adapter.downloadRecording(recordingId)

    if (downloaded.ok) {
      return ok({
        body: downloaded.value.body,
        filename: 'browser-recording.mp4',
        kind: 'recording',
        mimeType: downloaded.value.contentType,
      })
    }

    if (readStatusCode(downloaded.error) !== 202 || attempt === 4) {
      return downloaded
    }

    await delay(500)
  }

  return toProviderError(`Kernel recording ${recordingId} did not finish downloading`)
}

const enforceOutputByteLimit = (
  policy: KernelPolicy,
  artifacts: PersistKernelArtifactInput[],
): Result<null, DomainError> => {
  const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.body.byteLength, 0)

  return totalBytes > policy.outputs.maxOutputBytes
    ? toConflictError(
        `browser job outputs (${totalBytes} bytes) exceed the kernel policy limit of ${policy.outputs.maxOutputBytes} bytes`,
      )
    : ok(null)
}

export const createKernelBrowserService = (input: {
  artifactService: ReturnType<typeof createKernelArtifactService>
  db: Parameters<typeof createAgentRevisionRepository>[0]
}): KernelBrowserService => ({
  runBrowserJob: async (context, args) => {
    if (!context.run.agentRevisionId) {
      return toConflictError('browser execution requires a bound agent revision')
    }

    const adapter = context.services.kernel.getAdapter()
    const availability = context.services.kernel.getAvailability()

    if (!adapter || !availability.available) {
      return toConflictError('Kernel browser runtime is not available')
    }

    if (!adapter.supportsBrowserJobs) {
      return err({
        message: `Kernel provider ${adapter.provider} is not wired for browser jobs yet`,
        provider: `kernel_${adapter.provider}`,
        retryable: false,
        type: 'provider',
      })
    }

    const revision = createAgentRevisionRepository(input.db).getById(
      context.tenantScope,
      context.run.agentRevisionId,
    )

    if (!revision.ok) {
      return revision
    }

    const policy = parseKernelPolicyJson(revision.value.kernelPolicyJson)

    if (!policy.ok) {
      return policy
    }

    const validated = validateKernelBrowserRequest(policy.value, args)

    if (!validated.ok) {
      return validated
    }

    const sessionRepository = createKernelSessionRepository(input.db)
    const activeSessionCount = sessionRepository.countActive(context.tenantScope)

    if (!activeSessionCount.ok) {
      return activeSessionCount
    }

    if (activeSessionCount.value >= policy.value.browser.maxConcurrentSessions) {
      return err({
        message: `kernel policy allows at most ${policy.value.browser.maxConcurrentSessions} concurrent browser session(s)`,
        type: 'capacity',
      })
    }

    const sessionId = asKernelSessionId(context.createId('kse'))
    const createdAt = context.nowIso()
    const createdSession = sessionRepository.create(context.tenantScope, {
      createdAt,
      endpoint: adapter.describeEndpoint(),
      id: sessionId,
      policySnapshotJson: toJsonRecord(policy.value),
      provider: adapter.provider,
      requestJson: toJsonRecord(args),
      runId: context.run.id,
      sessionId: context.run.sessionId,
      status: 'pending',
      threadId: context.run.threadId,
      toolExecutionId: context.toolCallId,
    })

    if (!createdSession.ok) {
      return createdSession
    }

    const startedAt = context.nowIso()
    const runningSession = sessionRepository.update(context.tenantScope, {
      id: createdSession.value.id,
      startedAt,
      status: 'running',
    })

    if (!runningSession.ok) {
      return runningSession
    }

    const recordingId = `session-${runningSession.value.id}`
    let recordingStarted = false

    try {
      if (validated.value.outputs.recording) {
        const startedRecording = await adapter.startRecording({
          id: recordingId,
          maxDurationSec: validated.value.timeoutSec,
        })

        if (!startedRecording.ok) {
          const completedAt = context.nowIso()

          sessionRepository.update(context.tenantScope, {
            completedAt,
            durationMs: toDurationMs(startedAt, completedAt),
            errorText: startedRecording.error.message,
            id: runningSession.value.id,
            status: 'failed',
          })

          return startedRecording
        }

        recordingStarted = true
      }

      const executed = await adapter.executePlaywright({
        code: buildBrowserExecutionCode({
          args: {
            outputs: {
              console: validated.value.outputs.console,
              cookies: validated.value.outputs.cookies,
              html: validated.value.outputs.html,
              pdf: validated.value.outputs.pdf,
              screenshot: validated.value.outputs.screenshot,
            },
            script: validated.value.script,
            url: validated.value.url,
            viewport: validated.value.viewport,
          },
          policy: policy.value,
        }),
        timeoutSec: validated.value.timeoutSec,
      })

      if (!executed.ok) {
        const completedAt = context.nowIso()
        const status = detectFailedStatus(executed.error.message)

        if (recordingStarted) {
          await adapter.stopRecording(recordingId)
        }

        sessionRepository.update(context.tenantScope, {
          completedAt,
          durationMs: toDurationMs(startedAt, completedAt),
          errorText: executed.error.message,
          id: runningSession.value.id,
          status,
        })

        return executed
      }

      if (recordingStarted) {
        const stoppedRecording = await adapter.stopRecording(recordingId)

        if (!stoppedRecording.ok) {
          const completedAt = context.nowIso()

          sessionRepository.update(context.tenantScope, {
            completedAt,
            durationMs: toDurationMs(startedAt, completedAt),
            errorText: stoppedRecording.error.message,
            id: runningSession.value.id,
            status: 'failed',
          })

          return stoppedRecording
        }
      }

      const payload = parseExecutionPayload(executed.value.result)

      if (!payload.ok) {
        const completedAt = context.nowIso()

        sessionRepository.update(context.tenantScope, {
          completedAt,
          durationMs: toDurationMs(startedAt, completedAt),
          errorText: payload.error.message,
          id: runningSession.value.id,
          status: 'failed',
        })

        return payload
      }

      const artifacts: PersistKernelArtifactInput[] = []
      const screenshot = toArtifactBody('screenshot', payload.value.artifacts.screenshot)
      const html = toArtifactBody('html', payload.value.artifacts.html)
      const pdf = toArtifactBody('pdf', payload.value.artifacts.pdf)
      const cookies = toArtifactBody('cookies', payload.value.artifacts.cookies)

      for (const artifactResult of [screenshot, html, pdf, cookies]) {
        if (!artifactResult.ok) {
          const completedAt = context.nowIso()

          sessionRepository.update(context.tenantScope, {
            completedAt,
            durationMs: toDurationMs(startedAt, completedAt),
            errorText: artifactResult.error.message,
            id: runningSession.value.id,
            status: 'failed',
          })

          return artifactResult
        }

        if (artifactResult.value) {
          artifacts.push(artifactResult.value)
        }
      }

      if (recordingStarted) {
        const recordingArtifact = await downloadRecordingWithRetry(context, recordingId)

        if (!recordingArtifact.ok) {
          const completedAt = context.nowIso()

          sessionRepository.update(context.tenantScope, {
            completedAt,
            durationMs: toDurationMs(startedAt, completedAt),
            errorText: recordingArtifact.error.message,
            id: runningSession.value.id,
            status: 'failed',
          })

          return recordingArtifact
        }

        artifacts.push(recordingArtifact.value)
      }

      const limit = enforceOutputByteLimit(policy.value, artifacts)

      if (!limit.ok) {
        const completedAt = context.nowIso()

        sessionRepository.update(context.tenantScope, {
          completedAt,
          durationMs: toDurationMs(startedAt, completedAt),
          errorText: limit.error.message,
          id: runningSession.value.id,
          status: 'failed',
        })

        return limit
      }

      const completedAt = context.nowIso()
      const durationMs = toDurationMs(startedAt, completedAt)
      const sessionForArtifacts: KernelSessionRecord = {
        ...runningSession.value,
        completedAt,
        durationMs,
        resultJson: {
          artifactCount: artifacts.length,
          consoleMessages: payload.value.consoleMessages,
          page: payload.value.page,
          userResult: payload.value.userResult,
        },
        startedAt,
        status: 'completed',
        stdoutText: payload.value.consoleMessages.join('\n') || null,
      }
      const persistedArtifacts = await input.artifactService.persistArtifacts(
        context,
        sessionForArtifacts,
        artifacts,
      )

      if (!persistedArtifacts.ok) {
        sessionRepository.update(context.tenantScope, {
          completedAt,
          durationMs,
          errorText: persistedArtifacts.error.message,
          id: runningSession.value.id,
          status: 'failed',
        })

        return persistedArtifacts
      }

      const completedSession = sessionRepository.update(context.tenantScope, {
        completedAt,
        durationMs,
        id: runningSession.value.id,
        resultJson: sessionForArtifacts.resultJson,
        status: 'completed',
        stdoutText: sessionForArtifacts.stdoutText,
      })

      if (!completedSession.ok) {
        return completedSession
      }

      return ok({
        artifacts: persistedArtifacts.value.map((artifact) => ({
          fileId: artifact.file.id,
          kind: artifact.kind,
          mimeType: artifact.file.mimeType,
          name: artifact.file.originalFilename ?? artifact.file.title ?? artifact.file.id,
          sizeBytes: artifact.file.sizeBytes,
        })),
        consoleOutput:
          validated.value.outputs.console && payload.value.consoleMessages.length > 0
            ? payload.value.consoleMessages.join('\n')
            : null,
        durationMs,
        kernelSessionId: completedSession.value.id,
        page: payload.value.page,
        result: payload.value.userResult,
        status: 'completed',
      })
    } catch (error) {
      if (recordingStarted) {
        await adapter.stopRecording(recordingId)
      }

      const completedAt = context.nowIso()
      const message =
        error instanceof Error ? error.message : 'Unknown kernel browser execution failure'

      sessionRepository.update(context.tenantScope, {
        completedAt,
        durationMs: toDurationMs(startedAt, completedAt),
        errorText: message,
        id: runningSession.value.id,
        status: detectFailedStatus(message),
      })

      return toConflictError(message)
    }
  },
})
