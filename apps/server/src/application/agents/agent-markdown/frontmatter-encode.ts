import type { RawAgentMarkdownFrontmatter } from './frontmatter-schema'
import type { AgentMarkdownFrontmatter } from './types'

/**
 * Converts the camelCase domain frontmatter shape back into the raw,
 * snake_case YAML shape written to persisted agent markdown, omitting any
 * fields whose value is undefined/empty so the serialized YAML stays minimal.
 */
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
