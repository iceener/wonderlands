import { asAgentId, asAgentRevisionId } from '../../../shared/ids'
import type { RawAgentMarkdownFrontmatter } from './frontmatter-schema'
import type { AgentMarkdownFrontmatter } from './types'

/**
 * Converts the raw, snake_case YAML frontmatter shape (as validated by the
 * zod schema) into the camelCase domain shape used throughout the app.
 */
export const toTypedFrontmatter = (
  value: RawAgentMarkdownFrontmatter,
): AgentMarkdownFrontmatter => ({
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
