import matter from 'gray-matter'
import { z } from 'zod'
import {
  type AgentKind,
  type AgentVisibility,
  agentKindValues,
  agentVisibilityValues,
  type DelegationMode,
  delegationModeValues,
} from '../../domain/agents/agent-types'
import { kernelNetworkModeValues } from '../../domain/kernel/types'
import {
  sandboxNetworkModeValues,
  sandboxRuntimeValues,
  sandboxVaultAccessModeValues,
} from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import { type AgentId, type AgentRevisionId, asAgentId, asAgentRevisionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { KernelPolicyInput } from '../kernel/kernel-policy'
import type { SandboxPolicyInput } from '../sandbox/sandbox-policy'

const frontmatterFence = '---'
const agentSlugPattern = /^[a-z0-9][a-z0-9_-]*$/

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    agentSlugPattern,
    'must be a lowercase slug using letters, numbers, underscores, or hyphens',
  )

const rawAgentMarkdownFrontmatterSchema = z
  .object({
    agent_id: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    garden: z
      .object({
        preferred_slugs: z.array(z.string().trim().min(1).max(200)).optional(),
      })
      .strict()
      .optional(),
    kind: z.enum(agentKindValues),
    kernel: z
      .object({
        browser: z
          .object({
            allow_recording: z.boolean().optional(),
            default_viewport: z
              .object({
                height: z.number().int().positive().max(4320),
                width: z.number().int().positive().max(7680),
              })
              .strict()
              .optional(),
            max_concurrent_sessions: z.number().int().positive().max(8).optional(),
            max_duration_sec: z.number().int().positive().max(3600).optional(),
          })
          .strict()
          .optional(),
        enabled: z.boolean().optional(),
        network: z
          .object({
            allowed_hosts: z.array(z.string().trim().min(1).max(500)).optional(),
            blocked_hosts: z.array(z.string().trim().min(1).max(500)).optional(),
            mode: z.enum(kernelNetworkModeValues).optional(),
          })
          .strict()
          .optional(),
        outputs: z
          .object({
            allow_cookies: z.boolean().optional(),
            allow_html: z.boolean().optional(),
            allow_pdf: z.boolean().optional(),
            allow_recording: z.boolean().optional(),
            allow_screenshot: z.boolean().optional(),
            max_output_bytes: z.number().int().positive().max(500_000_000).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    memory: z
      .object({
        child_promotion: z.string().trim().min(1).optional(),
        profile_scope: z.boolean().optional(),
      })
      .strict()
      .optional(),
    model: z
      .object({
        model_alias: z.string().trim().min(1),
        provider: z.string().trim().min(1),
        reasoning: z
          .object({
            effort: z.string().trim().min(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    name: z.string().trim().min(1).max(200),
    revision_id: z.string().trim().min(1).optional(),
    sandbox: z
      .object({
        enabled: z.boolean().optional(),
        network: z
          .object({
            allowed_hosts: z.array(z.string().trim().min(1).max(500)).optional(),
            mode: z.enum(sandboxNetworkModeValues).optional(),
          })
          .strict()
          .optional(),
        packages: z
          .object({
            allowed_packages: z
              .array(
                z
                  .object({
                    allow_install_scripts: z.boolean().optional(),
                    name: z.string().trim().min(1).max(200),
                    runtimes: z.array(z.enum(sandboxRuntimeValues)).min(1).optional(),
                    version_range: z.string().trim().min(1).max(200),
                  })
                  .strict(),
              )
              .optional(),
            allowed_registries: z.array(z.string().trim().min(1).max(500)).optional(),
            mode: z.enum(['disabled', 'allow_list', 'open']).optional(),
          })
          .strict()
          .optional(),
        runtime: z
          .object({
            allow_automatic_compat_fallback: z.boolean().optional(),
            allowed_engines: z.array(z.enum(sandboxRuntimeValues)).min(1).optional(),
            allow_workspace_scripts: z.boolean().optional(),
            default_engine: z.enum(sandboxRuntimeValues).optional(),
            max_duration_sec: z.number().int().positive().max(3600).optional(),
            max_input_bytes: z.number().int().positive().max(500_000_000).optional(),
            max_memory_mb: z.number().int().positive().max(32_768).optional(),
            max_output_bytes: z.number().int().positive().max(500_000_000).optional(),
            node_version: z.string().trim().min(1).max(50).optional(),
          })
          .strict()
          .optional(),
        shell: z
          .object({
            allowed_commands: z.array(z.string().trim().min(1).max(200)).optional(),
          })
          .strict()
          .optional(),
        vault: z
          .object({
            allowed_roots: z.array(z.string().trim().min(1).max(500)).optional(),
            mode: z.enum(sandboxVaultAccessModeValues).optional(),
            require_approval_for_delete: z.boolean().optional(),
            require_approval_for_move: z.boolean().optional(),
            require_approval_for_workspace_script: z.boolean().optional(),
            require_approval_for_write: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    schema: z.literal('agent/v1'),
    slug: slugSchema,
    subagents: z
      .array(
        z
          .object({
            alias: z.string().trim().min(1).max(120),
            mode: z.enum(delegationModeValues),
            slug: slugSchema,
          })
          .strict(),
      )
      .optional(),
    tools: z
      .object({
        mcp_mode: z.enum(['direct', 'code']).optional(),
        mcp_profile: z.string().trim().min(1).nullable().optional(),
        tool_profile_id: z.string().trim().min(1).nullable().optional(),
        native: z.array(z.string().trim().min(1)).optional(),
      })
      .strict()
      .optional(),
    visibility: z.enum(agentVisibilityValues),
    workspace: z
      .object({
        strategy: z.string().trim().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const nativeTools = value.tools?.native ?? []
    const duplicateNativeTool = nativeTools.find(
      (tool, index) => nativeTools.indexOf(tool) !== index,
    )

    if (duplicateNativeTool) {
      context.addIssue({
        code: 'custom',
        message: `tools.native contains duplicate entry "${duplicateNativeTool}"`,
        path: ['tools', 'native'],
      })
    }

    const subagents = value.subagents ?? []
    const duplicateAlias = subagents.find(
      (subagent, index) =>
        subagents.findIndex((candidate) => candidate.alias === subagent.alias) !== index,
    )

    if (duplicateAlias) {
      context.addIssue({
        code: 'custom',
        message: `subagents contains duplicate alias "${duplicateAlias.alias}"`,
        path: ['subagents'],
      })
    }

    const duplicateSlug = subagents.find(
      (subagent, index) =>
        subagents.findIndex((candidate) => candidate.slug === subagent.slug) !== index,
    )

    if (duplicateSlug) {
      context.addIssue({
        code: 'custom',
        message: `subagents contains duplicate slug "${duplicateSlug.slug}"`,
        path: ['subagents'],
      })
    }

    const preferredGardenSlugs = value.garden?.preferred_slugs ?? []
    const duplicateGardenSlug = preferredGardenSlugs.find(
      (slug, index) => preferredGardenSlugs.indexOf(slug) !== index,
    )

    if (duplicateGardenSlug) {
      context.addIssue({
        code: 'custom',
        message: `garden.preferred_slugs contains duplicate entry "${duplicateGardenSlug}"`,
        path: ['garden', 'preferred_slugs'],
      })
    }
  })

export type RawAgentMarkdownFrontmatter = z.infer<typeof rawAgentMarkdownFrontmatterSchema>

export interface AgentMarkdownSubagent {
  alias: string
  mode: DelegationMode
  slug: string
}

export interface AgentMarkdownFrontmatter {
  agentId?: AgentId
  description?: string
  garden?: {
    preferredSlugs?: string[]
  }
  kind: AgentKind
  kernel?: KernelPolicyInput
  memory?: {
    childPromotion?: string
    profileScope?: boolean
  }
  model?: {
    modelAlias: string
    provider: string
    reasoning?: {
      effort: string
    }
  }
  name: string
  revisionId?: AgentRevisionId
  sandbox?: SandboxPolicyInput
  schema: 'agent/v1'
  slug: string
  subagents?: AgentMarkdownSubagent[]
  tools?: {
    mcpMode?: 'direct' | 'code'
    toolProfileId?: string | null
    native?: string[]
  }
  visibility: AgentVisibility
  workspace?: {
    strategy: string
  }
}

export interface AgentMarkdownDocument {
  frontmatter: AgentMarkdownFrontmatter
  instructionsMd: string
}

const toValidationError = (message: string): Result<never, DomainError> =>
  err({
    message,
    type: 'validation',
  })

const normalizeNewlines = (value: string): string => value.replace(/\r\n?/g, '\n')

const normalizeInstructionsMd = (value: string): string => normalizeNewlines(value).trim()

const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''

      return `${path}${issue.message}`
    })
    .join('; ')

const toTypedFrontmatter = (value: RawAgentMarkdownFrontmatter): AgentMarkdownFrontmatter => ({
  agentId: value.agent_id ? asAgentId(value.agent_id) : undefined,
  description: value.description,
  garden: value.garden
    ? {
        preferredSlugs: value.garden.preferred_slugs,
      }
    : undefined,
  kind: value.kind,
  kernel: value.kernel
    ? {
        browser: value.kernel.browser
          ? {
              allowRecording: value.kernel.browser.allow_recording,
              defaultViewport: value.kernel.browser.default_viewport
                ? {
                    height: value.kernel.browser.default_viewport.height,
                    width: value.kernel.browser.default_viewport.width,
                  }
                : undefined,
              maxConcurrentSessions: value.kernel.browser.max_concurrent_sessions,
              maxDurationSec: value.kernel.browser.max_duration_sec,
            }
          : undefined,
        enabled: value.kernel.enabled,
        network: value.kernel.network
          ? {
              allowedHosts: value.kernel.network.allowed_hosts,
              blockedHosts: value.kernel.network.blocked_hosts,
              mode: value.kernel.network.mode,
            }
          : undefined,
        outputs: value.kernel.outputs
          ? {
              allowCookies: value.kernel.outputs.allow_cookies,
              allowHtml: value.kernel.outputs.allow_html,
              allowPdf: value.kernel.outputs.allow_pdf,
              allowRecording: value.kernel.outputs.allow_recording,
              allowScreenshot: value.kernel.outputs.allow_screenshot,
              maxOutputBytes: value.kernel.outputs.max_output_bytes,
            }
          : undefined,
      }
    : undefined,
  memory: value.memory
    ? {
        childPromotion: value.memory.child_promotion,
        profileScope: value.memory.profile_scope,
      }
    : undefined,
  model: value.model
    ? {
        modelAlias: value.model.model_alias,
        provider: value.model.provider,
        reasoning: value.model.reasoning
          ? {
              effort: value.model.reasoning.effort,
            }
          : undefined,
      }
    : undefined,
  name: value.name,
  revisionId: value.revision_id ? asAgentRevisionId(value.revision_id) : undefined,
  sandbox: value.sandbox
    ? {
        enabled: value.sandbox.enabled,
        network: value.sandbox.network
          ? {
              allowedHosts: value.sandbox.network.allowed_hosts,
              mode: value.sandbox.network.mode,
            }
          : undefined,
        packages: value.sandbox.packages
          ? {
              allowedPackages: value.sandbox.packages.allowed_packages?.map((entry) => ({
                allowInstallScripts: entry.allow_install_scripts,
                name: entry.name,
                runtimes: entry.runtimes,
                versionRange: entry.version_range,
              })),
              allowedRegistries: value.sandbox.packages.allowed_registries,
              mode: value.sandbox.packages.mode,
            }
          : undefined,
        runtime: value.sandbox.runtime
          ? {
              allowAutomaticCompatFallback: value.sandbox.runtime.allow_automatic_compat_fallback,
              allowedEngines: value.sandbox.runtime.allowed_engines,
              allowWorkspaceScripts: value.sandbox.runtime.allow_workspace_scripts,
              defaultEngine: value.sandbox.runtime.default_engine,
              maxDurationSec: value.sandbox.runtime.max_duration_sec,
              maxInputBytes: value.sandbox.runtime.max_input_bytes,
              maxMemoryMb: value.sandbox.runtime.max_memory_mb,
              maxOutputBytes: value.sandbox.runtime.max_output_bytes,
              nodeVersion: value.sandbox.runtime.node_version,
            }
          : undefined,
        shell: value.sandbox.shell
          ? {
              allowedCommands: value.sandbox.shell.allowed_commands,
            }
          : undefined,
        vault: value.sandbox.vault
          ? {
              allowedRoots: value.sandbox.vault.allowed_roots,
              mode: value.sandbox.vault.mode,
              requireApprovalForDelete: value.sandbox.vault.require_approval_for_delete,
              requireApprovalForMove: value.sandbox.vault.require_approval_for_move,
              requireApprovalForWorkspaceScript:
                value.sandbox.vault.require_approval_for_workspace_script,
              requireApprovalForWrite: value.sandbox.vault.require_approval_for_write,
            }
          : undefined,
      }
    : undefined,
  schema: value.schema,
  slug: value.slug,
  subagents: value.subagents?.map((subagent) => ({
    alias: subagent.alias,
    mode: subagent.mode,
    slug: subagent.slug,
  })),
  tools: value.tools
    ? {
        mcpMode: value.tools.mcp_mode,
        toolProfileId: value.tools.tool_profile_id ?? value.tools.mcp_profile,
        native: value.tools.native,
      }
    : undefined,
  visibility: value.visibility,
  workspace: value.workspace
    ? {
        strategy: value.workspace.strategy,
      }
    : undefined,
})

export const toAgentMarkdownFrontmatterJson = (
  value: AgentMarkdownFrontmatter,
): RawAgentMarkdownFrontmatter => ({
  ...(value.agentId ? { agent_id: value.agentId } : {}),
  ...(value.description ? { description: value.description } : {}),
  ...(value.garden
    ? {
        garden: {
          ...(value.garden.preferredSlugs && value.garden.preferredSlugs.length > 0
            ? { preferred_slugs: value.garden.preferredSlugs }
            : {}),
        },
      }
    : {}),
  kind: value.kind,
  ...(value.kernel
    ? {
        kernel: {
          ...(value.kernel.enabled !== undefined ? { enabled: value.kernel.enabled } : {}),
          ...(value.kernel.browser
            ? {
                browser: {
                  ...(value.kernel.browser.allowRecording !== undefined
                    ? { allow_recording: value.kernel.browser.allowRecording }
                    : {}),
                  ...(value.kernel.browser.defaultViewport
                    ? {
                        default_viewport: {
                          height: value.kernel.browser.defaultViewport.height,
                          width: value.kernel.browser.defaultViewport.width,
                        },
                      }
                    : {}),
                  ...(value.kernel.browser.maxConcurrentSessions !== undefined
                    ? {
                        max_concurrent_sessions: value.kernel.browser.maxConcurrentSessions,
                      }
                    : {}),
                  ...(value.kernel.browser.maxDurationSec !== undefined
                    ? { max_duration_sec: value.kernel.browser.maxDurationSec }
                    : {}),
                },
              }
            : {}),
          ...(value.kernel.network
            ? {
                network: {
                  ...(value.kernel.network.allowedHosts &&
                  value.kernel.network.allowedHosts.length > 0
                    ? { allowed_hosts: value.kernel.network.allowedHosts }
                    : {}),
                  ...(value.kernel.network.blockedHosts &&
                  value.kernel.network.blockedHosts.length > 0
                    ? { blocked_hosts: value.kernel.network.blockedHosts }
                    : {}),
                  ...(value.kernel.network.mode !== undefined
                    ? { mode: value.kernel.network.mode }
                    : {}),
                },
              }
            : {}),
          ...(value.kernel.outputs
            ? {
                outputs: {
                  ...(value.kernel.outputs.allowCookies !== undefined
                    ? { allow_cookies: value.kernel.outputs.allowCookies }
                    : {}),
                  ...(value.kernel.outputs.allowHtml !== undefined
                    ? { allow_html: value.kernel.outputs.allowHtml }
                    : {}),
                  ...(value.kernel.outputs.allowPdf !== undefined
                    ? { allow_pdf: value.kernel.outputs.allowPdf }
                    : {}),
                  ...(value.kernel.outputs.allowRecording !== undefined
                    ? { allow_recording: value.kernel.outputs.allowRecording }
                    : {}),
                  ...(value.kernel.outputs.allowScreenshot !== undefined
                    ? { allow_screenshot: value.kernel.outputs.allowScreenshot }
                    : {}),
                  ...(value.kernel.outputs.maxOutputBytes !== undefined
                    ? { max_output_bytes: value.kernel.outputs.maxOutputBytes }
                    : {}),
                },
              }
            : {}),
        },
      }
    : {}),
  ...(value.memory
    ? {
        memory: {
          ...(value.memory.childPromotion ? { child_promotion: value.memory.childPromotion } : {}),
          ...(value.memory.profileScope !== undefined
            ? { profile_scope: value.memory.profileScope }
            : {}),
        },
      }
    : {}),
  ...(value.model
    ? {
        model: {
          model_alias: value.model.modelAlias,
          provider: value.model.provider,
          ...(value.model.reasoning
            ? {
                reasoning: {
                  effort: value.model.reasoning.effort,
                },
              }
            : {}),
        },
      }
    : {}),
  name: value.name,
  ...(value.revisionId ? { revision_id: value.revisionId } : {}),
  ...(value.sandbox
    ? {
        sandbox: {
          ...(value.sandbox.enabled !== undefined ? { enabled: value.sandbox.enabled } : {}),
          ...(value.sandbox.network
            ? {
                network: {
                  ...(value.sandbox.network.allowedHosts &&
                  value.sandbox.network.allowedHosts.length > 0
                    ? { allowed_hosts: value.sandbox.network.allowedHosts }
                    : {}),
                  ...(value.sandbox.network.mode !== undefined
                    ? { mode: value.sandbox.network.mode }
                    : {}),
                },
              }
            : {}),
          ...(value.sandbox.packages
            ? {
                packages: {
                  ...(value.sandbox.packages.allowedPackages &&
                  value.sandbox.packages.allowedPackages.length > 0
                    ? {
                        allowed_packages: value.sandbox.packages.allowedPackages.map((entry) => ({
                          ...(entry.allowInstallScripts !== undefined
                            ? { allow_install_scripts: entry.allowInstallScripts }
                            : {}),
                          name: entry.name,
                          ...(entry.runtimes && entry.runtimes.length > 0
                            ? { runtimes: entry.runtimes }
                            : {}),
                          version_range: entry.versionRange,
                        })),
                      }
                    : {}),
                  ...(value.sandbox.packages.allowedRegistries &&
                  value.sandbox.packages.allowedRegistries.length > 0
                    ? { allowed_registries: value.sandbox.packages.allowedRegistries }
                    : {}),
                  ...(value.sandbox.packages.mode !== undefined
                    ? { mode: value.sandbox.packages.mode }
                    : {}),
                },
              }
            : {}),
          ...(value.sandbox.runtime
            ? {
                runtime: {
                  ...(value.sandbox.runtime.allowAutomaticCompatFallback !== undefined
                    ? {
                        allow_automatic_compat_fallback:
                          value.sandbox.runtime.allowAutomaticCompatFallback,
                      }
                    : {}),
                  ...(value.sandbox.runtime.allowedEngines &&
                  value.sandbox.runtime.allowedEngines.length > 0
                    ? { allowed_engines: value.sandbox.runtime.allowedEngines }
                    : {}),
                  ...(value.sandbox.runtime.allowWorkspaceScripts !== undefined
                    ? {
                        allow_workspace_scripts: value.sandbox.runtime.allowWorkspaceScripts,
                      }
                    : {}),
                  ...(value.sandbox.runtime.defaultEngine !== undefined
                    ? { default_engine: value.sandbox.runtime.defaultEngine }
                    : {}),
                  ...(value.sandbox.runtime.maxDurationSec !== undefined
                    ? { max_duration_sec: value.sandbox.runtime.maxDurationSec }
                    : {}),
                  ...(value.sandbox.runtime.maxInputBytes !== undefined
                    ? { max_input_bytes: value.sandbox.runtime.maxInputBytes }
                    : {}),
                  ...(value.sandbox.runtime.maxMemoryMb !== undefined
                    ? { max_memory_mb: value.sandbox.runtime.maxMemoryMb }
                    : {}),
                  ...(value.sandbox.runtime.maxOutputBytes !== undefined
                    ? { max_output_bytes: value.sandbox.runtime.maxOutputBytes }
                    : {}),
                  ...(value.sandbox.runtime.nodeVersion !== undefined
                    ? { node_version: value.sandbox.runtime.nodeVersion }
                    : {}),
                },
              }
            : {}),
          ...(value.sandbox.shell
            ? {
                shell: {
                  ...(value.sandbox.shell.allowedCommands &&
                  value.sandbox.shell.allowedCommands.length > 0
                    ? { allowed_commands: value.sandbox.shell.allowedCommands }
                    : {}),
                },
              }
            : {}),
          ...(value.sandbox.vault
            ? {
                vault: {
                  ...(value.sandbox.vault.allowedRoots &&
                  value.sandbox.vault.allowedRoots.length > 0
                    ? { allowed_roots: value.sandbox.vault.allowedRoots }
                    : {}),
                  ...(value.sandbox.vault.mode !== undefined
                    ? { mode: value.sandbox.vault.mode }
                    : {}),
                  ...(value.sandbox.vault.requireApprovalForDelete !== undefined
                    ? {
                        require_approval_for_delete: value.sandbox.vault.requireApprovalForDelete,
                      }
                    : {}),
                  ...(value.sandbox.vault.requireApprovalForMove !== undefined
                    ? { require_approval_for_move: value.sandbox.vault.requireApprovalForMove }
                    : {}),
                  ...(value.sandbox.vault.requireApprovalForWorkspaceScript !== undefined
                    ? {
                        require_approval_for_workspace_script:
                          value.sandbox.vault.requireApprovalForWorkspaceScript,
                      }
                    : {}),
                  ...(value.sandbox.vault.requireApprovalForWrite !== undefined
                    ? { require_approval_for_write: value.sandbox.vault.requireApprovalForWrite }
                    : {}),
                },
              }
            : {}),
        },
      }
    : {}),
  schema: value.schema,
  slug: value.slug,
  ...(value.subagents && value.subagents.length > 0
    ? {
        subagents: value.subagents.map((subagent) => ({
          alias: subagent.alias,
          mode: subagent.mode,
          slug: subagent.slug,
        })),
      }
    : {}),
  ...(value.tools
    ? {
        tools: {
          ...(value.tools.mcpMode !== undefined ? { mcp_mode: value.tools.mcpMode } : {}),
          ...(value.tools.toolProfileId !== undefined
            ? { tool_profile_id: value.tools.toolProfileId }
            : {}),
          ...(value.tools.native && value.tools.native.length > 0
            ? { native: value.tools.native }
            : {}),
        },
      }
    : {}),
  visibility: value.visibility,
  ...(value.workspace
    ? {
        workspace: {
          strategy: value.workspace.strategy,
        },
      }
    : {}),
})

const parseFrontmatterJson = (value: unknown): Result<AgentMarkdownFrontmatter, DomainError> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return toValidationError('agent frontmatter must be a YAML object')
  }

  const parsed = rawAgentMarkdownFrontmatterSchema.safeParse(value)

  if (!parsed.success) {
    return toValidationError(formatZodError(parsed.error))
  }

  return ok(toTypedFrontmatter(parsed.data))
}

export const parseAgentMarkdown = (
  markdown: string,
): Result<AgentMarkdownDocument, DomainError> => {
  const normalized = normalizeNewlines(markdown)

  if (!normalized.startsWith(`${frontmatterFence}\n`)) {
    return toValidationError('agent markdown must start with frontmatter delimited by ---')
  }

  let parsedMatter: matter.GrayMatterFile<string>

  try {
    parsedMatter = matter(normalized)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown frontmatter parse failure'

    return toValidationError(`invalid agent frontmatter: ${message}`)
  }

  if (Object.keys(parsedMatter.data ?? {}).length === 0) {
    return toValidationError('agent markdown frontmatter cannot be empty')
  }

  const rawTools =
    parsedMatter.data &&
    typeof parsedMatter.data === 'object' &&
    !Array.isArray(parsedMatter.data) &&
    parsedMatter.data.tools &&
    typeof parsedMatter.data.tools === 'object' &&
    !Array.isArray(parsedMatter.data.tools)
      ? (parsedMatter.data.tools as Record<string, unknown>)
      : null

  if (rawTools && rawTools.mcp_profile !== undefined) {
    return toValidationError('tools.mcp_profile is no longer supported; use tools.tool_profile_id')
  }

  const frontmatter = parseFrontmatterJson(parsedMatter.data)

  if (!frontmatter.ok) {
    return frontmatter
  }

  const instructionsMd = normalizeInstructionsMd(parsedMatter.content)

  if (instructionsMd.length === 0) {
    return toValidationError('agent markdown body cannot be empty')
  }

  return ok({
    frontmatter: frontmatter.value,
    instructionsMd,
  })
}

export const parseStoredAgentFrontmatter = (
  value: Record<string, unknown>,
): Result<AgentMarkdownFrontmatter, DomainError> => parseFrontmatterJson(value)

export const serializeAgentMarkdown = (document: AgentMarkdownDocument): string => {
  const frontmatterJson = toAgentMarkdownFrontmatterJson(document.frontmatter)
  const serialized = matter.stringify(
    normalizeInstructionsMd(document.instructionsMd),
    frontmatterJson,
    {
      delimiters: frontmatterFence,
      language: 'yaml',
    },
  )

  return `${normalizeNewlines(serialized).trimEnd()}\n`
}
