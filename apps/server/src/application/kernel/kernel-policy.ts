import { z } from 'zod'

import type { KernelPolicy, KernelViewport } from '../../domain/kernel/types'
import { kernelNetworkModeValues } from '../../domain/kernel/types'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

const viewportInputSchema = z
  .object({
    height: z.number().int().positive().max(4320),
    width: z.number().int().positive().max(7680),
  })
  .strict()

const browserPolicyInputSchema = z
  .object({
    allowRecording: z.boolean().optional(),
    defaultViewport: viewportInputSchema.optional(),
    maxConcurrentSessions: z.number().int().positive().max(8).optional(),
    maxDurationSec: z.number().int().positive().max(3600).optional(),
  })
  .strict()

const networkPolicyInputSchema = z
  .object({
    allowedHosts: z.array(z.string().trim().min(1).max(500)).optional(),
    blockedHosts: z.array(z.string().trim().min(1).max(500)).optional(),
    mode: z.enum(kernelNetworkModeValues).optional(),
  })
  .strict()

const outputPolicyInputSchema = z
  .object({
    allowCookies: z.boolean().optional(),
    allowHtml: z.boolean().optional(),
    allowPdf: z.boolean().optional(),
    allowRecording: z.boolean().optional(),
    allowScreenshot: z.boolean().optional(),
    maxOutputBytes: z.number().int().positive().max(500_000_000).optional(),
  })
  .strict()

export const kernelPolicyInputSchema = z
  .object({
    browser: browserPolicyInputSchema.optional(),
    enabled: z.boolean().optional(),
    network: networkPolicyInputSchema.optional(),
    outputs: outputPolicyInputSchema.optional(),
  })
  .strict()

export type KernelPolicyInput = z.infer<typeof kernelPolicyInputSchema>

const selectorSchema = z.string().trim().min(1).max(1_000)

const screenshotOutputSchema = z.union([
  z.boolean(),
  z
    .object({
      fullPage: z.boolean().optional(),
      selector: selectorSchema.optional(),
    })
    .strict(),
])

const htmlOutputSchema = z.union([
  z.boolean(),
  z
    .object({
      selector: selectorSchema.optional(),
    })
    .strict(),
])

const runBrowserJobArgsSchema = z
  .object({
    outputs: z
      .object({
        console: z.boolean().optional(),
        cookies: z.boolean().optional(),
        html: htmlOutputSchema.optional(),
        pdf: z.boolean().optional(),
        recording: z.boolean().optional(),
        screenshot: screenshotOutputSchema.optional(),
      })
      .strict()
      .optional(),
    script: z.string().trim().min(1).max(50_000),
    task: z.string().trim().min(1).max(10_000),
    timeoutSec: z.number().int().positive().max(300).optional(),
    url: z.string().url().optional(),
    viewport: viewportInputSchema.optional(),
  })
  .strict()

export type RunBrowserJobArgs = z.infer<typeof runBrowserJobArgsSchema>

export interface KernelBrowserJobOutputs {
  console: boolean
  cookies: boolean
  html: null | {
    selector: string | null
  }
  pdf: boolean
  recording: boolean
  screenshot: null | {
    fullPage: boolean
    selector: string | null
  }
}

export interface ValidatedRunBrowserJobArgs {
  outputs: KernelBrowserJobOutputs
  script: string
  task: string
  timeoutSec: number
  url: string | null
  viewport: KernelViewport
}

const defaultKernelPolicy: KernelPolicy = {
  browser: {
    allowRecording: false,
    defaultViewport: {
      height: 900,
      width: 1440,
    },
    maxConcurrentSessions: 1,
    maxDurationSec: 60,
  },
  enabled: false,
  network: {
    allowedHosts: [],
    blockedHosts: [],
    mode: 'open',
  },
  outputs: {
    allowCookies: false,
    allowHtml: true,
    allowPdf: false,
    allowRecording: false,
    allowScreenshot: true,
    maxOutputBytes: 25_000_000,
  },
}

const toValidationError = (message: string): Result<never, DomainError> =>
  err({
    message,
    type: 'validation',
  })

const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''

      return `${path}${issue.message}`
    })
    .join('; ')

export const parseKernelPolicyJson = (value: unknown): Result<KernelPolicy, DomainError> => {
  const candidate =
    value === undefined || value === null
      ? {}
      : value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null

  if (!candidate) {
    return toValidationError('kernel policy must be an object')
  }

  const parsed = kernelPolicyInputSchema.safeParse(candidate)

  if (!parsed.success) {
    return toValidationError(formatZodError(parsed.error))
  }

  return ok({
    browser: {
      allowRecording:
        parsed.data.browser?.allowRecording ?? defaultKernelPolicy.browser.allowRecording,
      defaultViewport:
        parsed.data.browser?.defaultViewport ?? defaultKernelPolicy.browser.defaultViewport,
      maxConcurrentSessions:
        parsed.data.browser?.maxConcurrentSessions ??
        defaultKernelPolicy.browser.maxConcurrentSessions,
      maxDurationSec:
        parsed.data.browser?.maxDurationSec ?? defaultKernelPolicy.browser.maxDurationSec,
    },
    enabled: parsed.data.enabled ?? defaultKernelPolicy.enabled,
    network: {
      allowedHosts: parsed.data.network?.allowedHosts ?? defaultKernelPolicy.network.allowedHosts,
      blockedHosts: parsed.data.network?.blockedHosts ?? defaultKernelPolicy.network.blockedHosts,
      mode: parsed.data.network?.mode ?? defaultKernelPolicy.network.mode,
    },
    outputs: {
      allowCookies: parsed.data.outputs?.allowCookies ?? defaultKernelPolicy.outputs.allowCookies,
      allowHtml: parsed.data.outputs?.allowHtml ?? defaultKernelPolicy.outputs.allowHtml,
      allowPdf: parsed.data.outputs?.allowPdf ?? defaultKernelPolicy.outputs.allowPdf,
      allowRecording:
        parsed.data.outputs?.allowRecording ?? defaultKernelPolicy.outputs.allowRecording,
      allowScreenshot:
        parsed.data.outputs?.allowScreenshot ?? defaultKernelPolicy.outputs.allowScreenshot,
      maxOutputBytes:
        parsed.data.outputs?.maxOutputBytes ?? defaultKernelPolicy.outputs.maxOutputBytes,
    },
  })
}

const toPermissionError = (message: string): Result<never, DomainError> =>
  err({
    message,
    type: 'permission',
  })

const normalizeOutputs = (outputs: RunBrowserJobArgs['outputs']): KernelBrowserJobOutputs => ({
  console: outputs?.console ?? false,
  cookies: outputs?.cookies ?? false,
  html:
    outputs?.html === true
      ? { selector: null }
      : outputs?.html && typeof outputs.html === 'object'
        ? { selector: outputs.html.selector ?? null }
        : null,
  pdf: outputs?.pdf ?? false,
  recording: outputs?.recording ?? false,
  screenshot:
    outputs?.screenshot === true
      ? { fullPage: false, selector: null }
      : outputs?.screenshot && typeof outputs.screenshot === 'object'
        ? {
            fullPage: outputs.screenshot.fullPage ?? false,
            selector: outputs.screenshot.selector ?? null,
          }
        : null,
})

const matchesPolicyHost = (host: string, candidate: string): boolean =>
  host === candidate || host.endsWith(`.${candidate}`)

const validateInitialUrlAgainstPolicy = (
  policy: KernelPolicy,
  url: string | null,
): Result<null, DomainError> => {
  if (!url) {
    return ok(null)
  }

  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase()
  const blocked = policy.network.blockedHosts.some((candidate) =>
    matchesPolicyHost(host, candidate.toLowerCase()),
  )

  if (blocked) {
    return toPermissionError(`browser access to host ${host} is blocked by kernel policy`)
  }

  if (policy.network.mode === 'off') {
    return toPermissionError('browser network access is disabled by kernel policy')
  }

  if (
    policy.network.mode === 'allow_list' &&
    !policy.network.allowedHosts.some((candidate) =>
      matchesPolicyHost(host, candidate.toLowerCase()),
    )
  ) {
    return toPermissionError(`browser access to host ${host} is not allowed by kernel policy`)
  }

  return ok(null)
}

export const validateRunBrowserJobArgs = (
  value: unknown,
): Result<RunBrowserJobArgs, DomainError> => {
  const parsed = runBrowserJobArgsSchema.safeParse(value ?? {})

  return parsed.success ? ok(parsed.data) : toValidationError(formatZodError(parsed.error))
}

export const validateKernelBrowserRequest = (
  policy: KernelPolicy,
  args: RunBrowserJobArgs,
): Result<ValidatedRunBrowserJobArgs, DomainError> => {
  if (!policy.enabled) {
    return toPermissionError('browser execution is disabled by kernel policy')
  }

  const initialUrlAllowed = validateInitialUrlAgainstPolicy(policy, args.url ?? null)

  if (!initialUrlAllowed.ok) {
    return initialUrlAllowed
  }

  const outputs = normalizeOutputs(args.outputs)

  if (outputs.screenshot && !policy.outputs.allowScreenshot) {
    return toPermissionError('browser screenshots are disabled by kernel policy')
  }

  if (outputs.html && !policy.outputs.allowHtml) {
    return toPermissionError('browser HTML capture is disabled by kernel policy')
  }

  if (outputs.pdf && !policy.outputs.allowPdf) {
    return toPermissionError('browser PDF capture is disabled by kernel policy')
  }

  if (outputs.cookies && !policy.outputs.allowCookies) {
    return toPermissionError('browser cookie export is disabled by kernel policy')
  }

  if (outputs.recording && (!policy.browser.allowRecording || !policy.outputs.allowRecording)) {
    return toPermissionError('browser recording is disabled by kernel policy')
  }

  const timeoutSec = args.timeoutSec ?? policy.browser.maxDurationSec

  if (timeoutSec > policy.browser.maxDurationSec) {
    return toPermissionError(
      `browser timeout ${timeoutSec}s exceeds the kernel policy maximum of ${policy.browser.maxDurationSec}s`,
    )
  }

  return ok({
    outputs,
    script: args.script,
    task: args.task,
    timeoutSec,
    url: args.url ?? null,
    viewport: args.viewport ?? policy.browser.defaultViewport,
  })
}
