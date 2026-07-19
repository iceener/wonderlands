import { z } from 'zod'
import {
  agentKindValues,
  agentVisibilityValues,
  delegationModeValues,
} from '../../../domain/agents/agent-types'
import { kernelNetworkModeValues } from '../../../domain/kernel/types'
import {
  sandboxNetworkModeValues,
  sandboxRuntimeValues,
  sandboxVaultAccessModeValues,
} from '../../../domain/sandbox/types'

const agentSlugPattern = /^[a-z0-9][a-z0-9_-]*$/

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    agentSlugPattern,
    'must be a lowercase slug using letters, numbers, underscores, or hyphens',
  )

export const rawAgentMarkdownFrontmatterSchema = z
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
