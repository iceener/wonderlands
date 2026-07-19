import { z } from 'zod'
import type { ToolContext, ToolRegistry, ToolSpec } from '../../application/tooling/tool-registry'
import type { AppDatabase } from '../../db/client'
import type { DomainError } from '../../shared/errors'
import { asFileId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import { loadGardenAgentContext } from '../garden/garden-agent-context'
import { persistGeneratedImages } from '../images/generated-image-files'
import {
  buildMcpCodeModeCatalog,
  renderMcpCodeModeTypeScriptBundle,
  resolveMcpCodeModeTools,
  searchMcpCodeModeCatalog,
} from '../mcp/code-mode'
import { createFileRepository } from '../persistence/repositories'
import {
  isNativeToolAllowedForRun,
  isToolAllowedForRun,
  resolveMcpModeForRun,
} from './agent-runtime-policy'
import { createDelegationService } from './delegation-service'
import { resumeDelegatedRun } from './resume-delegated-run-service'

const delegateToAgentArgsSchema = z.object({
  agentAlias: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(10_000).optional(),
  task: z.string().trim().min(1).max(10_000),
})

const suspendWaitTypeSchema = z.enum(['human', 'upload', 'tool', 'mcp'])
const suspendTargetKindSchema = z.enum(['human_response', 'upload', 'external', 'mcp_operation'])

type SuspendWaitType = z.infer<typeof suspendWaitTypeSchema>
type SuspendTargetKind = z.infer<typeof suspendTargetKindSchema>

const waitTypeByTargetKind: Record<SuspendTargetKind, SuspendWaitType> = {
  external: 'tool',
  human_response: 'human',
  mcp_operation: 'mcp',
  upload: 'upload',
}

const targetKindByWaitType: Record<SuspendWaitType, SuspendTargetKind> = {
  human: 'human_response',
  mcp: 'mcp_operation',
  tool: 'external',
  upload: 'upload',
}

const defaultTargetRefByKind: Record<SuspendTargetKind, string> = {
  external: 'external',
  human_response: 'user_response',
  mcp_operation: 'mcp_operation',
  upload: 'upload',
}

const resolveSuspendWaitPair = (input: {
  targetKind?: SuspendTargetKind
  waitType?: SuspendWaitType
}):
  | {
      ok: true
      targetKind: SuspendTargetKind
      waitType: SuspendWaitType
    }
  | {
      error: string
      ok: false
    } => {
  const targetKind =
    input.targetKind ?? (input.waitType ? targetKindByWaitType[input.waitType] : 'human_response')
  const waitType =
    input.waitType ?? (input.targetKind ? waitTypeByTargetKind[input.targetKind] : 'human')

  return waitTypeByTargetKind[targetKind] === waitType
    ? {
        ok: true,
        targetKind,
        waitType,
      }
    : {
        error: `waitType "${waitType}" is not valid for targetKind "${targetKind}"`,
        ok: false,
      }
}

const suspendRunArgsSchema = z
  .object({
    details: z.unknown().optional(),
    reason: z.string().trim().min(1).max(10_000),
    targetKind: suspendTargetKindSchema.optional(),
    targetRef: z.string().trim().min(1).max(500).optional(),
    timeoutAt: z.string().trim().min(1).max(100).optional(),
    waitType: suspendWaitTypeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const resolved = resolveSuspendWaitPair({
      targetKind: value.targetKind,
      waitType: value.waitType,
    })

    if (!resolved.ok) {
      ctx.addIssue({
        code: 'custom',
        message: resolved.error,
        path: ['waitType'],
      })
    }
  })
  .transform((value) => {
    const resolved = resolveSuspendWaitPair({
      targetKind: value.targetKind,
      waitType: value.waitType,
    })

    if (!resolved.ok) {
      throw new Error(resolved.error)
    }

    return {
      details: value.details,
      reason: value.reason,
      targetKind: resolved.targetKind,
      targetRef: value.targetRef ?? defaultTargetRefByKind[resolved.targetKind],
      timeoutAt: value.timeoutAt ?? null,
      waitType: resolved.waitType,
    }
  })

const resumeDelegatedRunArgsSchema = z
  .object({
    approve: z.boolean().optional(),
    childRunId: z.string().trim().min(1).max(200),
    errorMessage: z.string().trim().min(1).max(10_000).optional(),
    output: z.unknown().optional(),
    rememberApproval: z.boolean().optional(),
    waitId: z.string().trim().min(1).max(200),
  })
  .refine(
    (value) =>
      value.approve !== undefined || value.output !== undefined || value.errorMessage !== undefined,
    {
      message: 'Either approve, output, or errorMessage is required',
    },
  )

const getGardenContextArgsSchema = z.object({}).strict()
const searchToolsArgsSchema = z
  .object({
    executableOnly: z.boolean().optional(),
    query: z.string().trim().min(1).max(500).optional(),
    scope: z.enum(['servers', 'tools', 'both']).optional(),
    serverId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
const getToolsArgsSchema = z
  .object({
    names: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
  })
  .strict()
const imageAspectRatioSchema = z.enum([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
  '1:8',
  '8:1',
  '1:4',
  '4:1',
])
const imageSizeSchema = z.enum(['0.5K', '1K', '2K', '4K'])
const imageReferenceSchema = z
  .object({
    fileId: z.string().trim().min(1).max(200),
  })
  .strict()
const generateImageArgsSchema = z
  .object({
    aspectRatio: imageAspectRatioSchema.optional(),
    imageSize: imageSizeSchema.optional(),
    prompt: z.string().trim().min(1).max(32_000),
    references: z.array(imageReferenceSchema).max(8).optional(),
  })
  .strict()

const toValidationResult = <TValue>(
  parsed: ReturnType<z.ZodType<TValue>['safeParse']>,
): Result<TValue, DomainError> =>
  parsed.success
    ? ok(parsed.data)
    : err({
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })

const loadImageReferences = async (
  context: ToolContext,
  references: Array<{ fileId: string }> | undefined,
): Promise<
  Result<
    Array<{
      dataBase64: string
      mimeType: string
    }>,
    DomainError
  >
> => {
  if (!references || references.length === 0) {
    return ok([])
  }

  const fileRepository = createFileRepository(context.db)
  const resolved: Array<{ dataBase64: string; mimeType: string }> = []

  for (const reference of references) {
    const normalizedReference = reference.fileId.trim()

    if (normalizedReference.startsWith('/vault/') || normalizedReference.startsWith('vault/')) {
      return err({
        message:
          'generate_image.references[].fileId does not accept workspace paths such as `/vault/attachments/...`. Use a real `fil_*` id from previous generate_image output or the full {{attachment:...}} token from attachment refs.',
        type: 'validation',
      })
    }

    if (
      normalizedReference.startsWith('/api/files/') ||
      normalizedReference.startsWith('http://') ||
      normalizedReference.startsWith('https://')
    ) {
      return err({
        message:
          'generate_image.references[].fileId does not accept render URLs such as `/api/files/...`. Use a real `fil_*` id from previous generate_image output or the full {{attachment:...}} token from attachment refs.',
        type: 'validation',
      })
    }

    if (!normalizedReference.startsWith('fil_')) {
      return err({
        message:
          'generate_image.references[].fileId must be a real `fil_*` id or the full {{attachment:...}} token from attachment refs. Do not pass filenames, `/vault/...` paths, `/api/files/...` URLs, or markdown there.',
        type: 'validation',
      })
    }

    const file = fileRepository.getById(context.tenantScope, asFileId(normalizedReference))

    if (!file.ok) {
      return file
    }

    if (!file.value.mimeType?.startsWith('image/')) {
      return err({
        message: `Referenced file ${reference.fileId} is not an image`,
        type: 'validation',
      })
    }

    const blob = await context.services.files.blobStore.get(file.value.storageKey)

    if (!blob.ok) {
      return blob
    }

    resolved.push({
      dataBase64: Buffer.from(blob.value.body).toString('base64'),
      mimeType: file.value.mimeType,
    })
  }

  return ok(resolved)
}

export const registerAgentNativeTools = (
  toolRegistry: ToolRegistry,
  input: {
    db: AppDatabase
    fileStorageRoot: string
  },
): void => {
  const delegationService = createDelegationService({
    db: input.db,
    fileStorageRoot: input.fileStorageRoot,
  })

  const delegateToAgentTool: ToolSpec<z.infer<typeof delegateToAgentArgsSchema>> = {
    attachmentRefResolutionPolicy: 'path_inline',
    description:
      'Create a private child run for one allowed subagent and wait for that delegated result. When the subagent needs to work with specific files (e.g. editing a generated image), include the relevant fileIds in the task or instructions so the subagent can use them.',
    domain: 'native',
    execute: async (context, args) => {
      const created = delegationService.createDelegatedChildRun({
        instructions: args.instructions ?? null,
        targetAlias: args.agentAlias,
        task: args.task,
        toolContext: context,
      })

      if (!created.ok) {
        return created
      }

      return ok({
        kind: 'waiting' as const,
        wait: {
          description: `Waiting for delegated child agent "${created.value.link.alias}"`,
          targetKind: 'run' as const,
          targetRef: `${created.value.childAgent.slug}:${created.value.childRun.id}`,
          targetRunId: created.value.childRun.id,
          type: 'agent' as const,
        },
      })
    },
    inputSchema: {
      additionalProperties: false,
      properties: {
        agentAlias: {
          description: 'Allowed subagent alias from the current agent profile.',
          type: 'string',
        },
        instructions: {
          description: 'Detailed instructions for the delegated child run.',
          type: 'string',
        },
        task: {
          description: 'Short task title or objective for the delegated child run.',
          type: 'string',
        },
      },
      required: ['agentAlias', 'task'],
      type: 'object',
    },
    isAvailable: (context) =>
      isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'delegate_to_agent'),
    name: 'delegate_to_agent',
    strict: false,
    validateArgs: (args) => toValidationResult(delegateToAgentArgsSchema.safeParse(args)),
  }

  const suspendRunTool: ToolSpec<z.infer<typeof suspendRunArgsSchema>> = {
    description:
      'Suspend the current run until missing user, file, MCP, or external input arrives.',
    domain: 'native',
    execute: async (_context, args) =>
      ok({
        kind: 'waiting' as const,
        wait: {
          description: args.reason,
          targetKind: args.targetKind,
          targetRef: args.targetRef,
          timeoutAt: args.timeoutAt,
          type: args.waitType,
        },
      }),
    inputSchema: {
      additionalProperties: false,
      properties: {
        details: {
          description: 'Optional structured details explaining what input is needed.',
        },
        reason: {
          description: 'Why this delegated run must pause before it can continue.',
          type: 'string',
        },
        targetKind: {
          description:
            'What kind of dependency this run is waiting on. Defaults to human_response.',
          enum: ['human_response', 'upload', 'external', 'mcp_operation'],
          type: 'string',
        },
        targetRef: {
          description: 'Optional stable label for the missing dependency or external operation.',
          type: 'string',
        },
        timeoutAt: {
          description: 'Optional ISO timestamp after which the wait should time out.',
          type: 'string',
        },
        waitType: {
          description: 'Optional wait category. Defaults based on targetKind.',
          enum: ['human', 'upload', 'tool', 'mcp'],
          type: 'string',
        },
      },
      required: ['reason'],
      type: 'object',
    },
    isAvailable: (context) =>
      isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'suspend_run'),
    name: 'suspend_run',
    strict: false,
    validateArgs: (args) => toValidationResult(suspendRunArgsSchema.safeParse(args)),
  }

  const resumeDelegatedRunTool: ToolSpec<z.infer<typeof resumeDelegatedRunArgsSchema>> = {
    attachmentRefResolutionPolicy: 'path_inline',
    description:
      'Provide missing input to a suspended delegated child run and wait for that child to continue.',
    domain: 'native',
    execute: async (context, args) => {
      const resumed = await resumeDelegatedRun(context, args)

      if (!resumed.ok) {
        return resumed
      }

      return ok({
        kind: 'waiting' as const,
        wait: {
          description: `Waiting for delegated child run "${resumed.value.childTask}" to continue`,
          targetKind: 'run' as const,
          targetRef: resumed.value.childRunId,
          targetRunId: resumed.value.childRunId,
          type: 'agent' as const,
        },
      })
    },
    inputSchema: {
      additionalProperties: false,
      properties: {
        childRunId: {
          description:
            'The childRunId returned by a prior delegated suspended result that this run should resume.',
          type: 'string',
        },
        approve: {
          description:
            'Optional explicit approval decision for a suspended delegated child wait that requires confirmation.',
          type: 'boolean',
        },
        errorMessage: {
          description:
            'Optional rejection or failure message to feed into the suspended child instead of output.',
          type: 'string',
        },
        output: {
          description:
            'The structured input to feed back into the suspended child wait. For a user reply, this is usually a compact object describing that answer.',
        },
        rememberApproval: {
          description:
            'Optional flag for confirmation waits. When true, persist the approval for future matching MCP tool fingerprints.',
          type: 'boolean',
        },
        waitId: {
          description: 'The pending child waitId returned by the suspended delegated result.',
          type: 'string',
        },
      },
      required: ['childRunId', 'waitId'],
      type: 'object',
    },
    isAvailable: (context) =>
      isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'resume_delegated_run'),
    name: 'resume_delegated_run',
    strict: false,
    validateArgs: (args) => toValidationResult(resumeDelegatedRunArgsSchema.safeParse(args)),
  }

  const getGardenContextTool: ToolSpec<z.infer<typeof getGardenContextArgsSchema>> = {
    description:
      'List Garden sites available in the current account workspace, their /vault roots, their local _meta/frontmatter.md references, and the rules for navigating Garden source files.',
    domain: 'native',
    execute: async (context) => {
      const resolved = loadGardenAgentContext(
        context.db,
        context.tenantScope,
        context.run.agentRevisionId,
      )

      if (!resolved.ok) {
        return resolved
      }

      return ok({
        kind: 'immediate' as const,
        output: resolved.value,
      })
    },
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: 'object',
    },
    isAvailable: (context) =>
      isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'get_garden_context'),
    name: 'get_garden_context',
    strict: true,
    validateArgs: (args) => toValidationResult(getGardenContextArgsSchema.safeParse(args ?? {})),
  }
  const isMcpCodeModeAvailable = (context: ToolContext): boolean =>
    resolveMcpModeForRun(input.db, context.tenantScope, context.run) === 'code'

  const buildCatalogForContext = (context: ToolContext) =>
    buildMcpCodeModeCatalog(
      context,
      context.services.tools
        .list(context)
        .filter((tool) => isToolAllowedForRun(context.db, context.tenantScope, context.run, tool)),
    )

  const searchToolsTool: ToolSpec<z.infer<typeof searchToolsArgsSchema>> = {
    description:
      'Search the active MCP code-mode catalog by server name, binding, title, or description. scope can target servers, tools, or both. query accepts either a plain substring or a /pattern/flags regex.',
    domain: 'native',
    execute: async (context, args) =>
      ok({
        kind: 'immediate' as const,
        output: searchMcpCodeModeCatalog(buildCatalogForContext(context), args),
      }),
    inputSchema: {
      additionalProperties: false,
      properties: {
        executableOnly: {
          description:
            'When true, return only tools currently executable in code mode and only servers that still have executable tools.',
          type: 'boolean',
        },
        query: {
          description:
            'Optional search string. Use plain text for substring matching or /pattern/flags for regex matching.',
          type: 'string',
        },
        scope: {
          description: 'Search servers, tools, or both. Defaults to both.',
          enum: ['servers', 'tools', 'both'],
          type: 'string',
        },
        serverId: {
          description: 'Optional exact server id filter.',
          type: 'string',
        },
      },
      type: 'object',
    },
    isAvailable: (context) =>
      isMcpCodeModeAvailable(context) &&
      isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'search_tools'),
    name: 'search_tools',
    strict: true,
    validateArgs: (args) => toValidationResult(searchToolsArgsSchema.safeParse(args ?? {})),
  }

  const getToolsTool: ToolSpec<z.infer<typeof getToolsArgsSchema>> = {
    description:
      'Resolve one or more MCP tools from the active code-mode catalog and return canonical callable bindings plus one merged TypeScript contract for the resolved bindings. In execute with `mode: "script"`, call the bindings exactly as returned here, for example spotify.player_status(...).',
    domain: 'native',
    execute: async (context, args) => {
      const catalog = buildCatalogForContext(context)
      const resolution = resolveMcpCodeModeTools(catalog, args.names)
      const resolvedTools = resolution.resolved.map((entry) => entry.tool)

      return ok({
        kind: 'immediate' as const,
        output: {
          ambiguous: resolution.ambiguous.map((entry) => ({
            matchedBy: entry.matchedBy,
            matches: entry.matches.map((tool) => ({
              binding: tool.binding,
              executable: tool.executable,
              serverId: tool.serverId,
              serverLabel: tool.serverLabel,
              title: tool.title,
            })),
            requestedName: entry.requestedName,
          })),
          missing: resolution.missing,
          resolved: resolution.resolved.map((entry) => ({
            binding: entry.tool.binding,
            description: entry.tool.description,
            executable: entry.tool.executable,
            serverId: entry.tool.serverId,
            serverLabel: entry.tool.serverLabel,
            title: entry.tool.title,
          })),
          ...(resolvedTools.length > 0
            ? {
                typescript: renderMcpCodeModeTypeScriptBundle(resolvedTools),
              }
            : {}),
        },
      })
    },
    inputSchema: {
      additionalProperties: false,
      properties: {
        names: {
          description:
            'One or more MCP tool names to resolve from search_tools results. Prefer exact bindings like linear.get_issue. Unique short names like get_issue are also accepted when unambiguous.',
          items: {
            type: 'string',
          },
          type: 'array',
        },
      },
      required: ['names'],
      type: 'object',
    },
    isAvailable: (context) =>
      isMcpCodeModeAvailable(context) &&
      isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'get_tools'),
    name: 'get_tools',
    strict: true,
    validateArgs: (args) => toValidationResult(getToolsArgsSchema.safeParse(args ?? {})),
  }

  const generateImageTool: ToolSpec<z.infer<typeof generateImageArgsSchema>> = {
    attachmentRefResolutionPolicy: 'file_id_only',
    attachmentRefTargetKeys: ['fileId'],
    description:
      'Generate or edit images. When called without references, generates a new image from the prompt. When called with references, edits or transforms the referenced image(s) according to the prompt. To edit a previously generated image, pass its fileId (from the previous generate_image output) in references. To edit a user-uploaded image, pass its attachment ref token in references — it will be resolved to a fileId automatically. For `references[].fileId`, use only a real `fil_*` id or a full {{attachment:...}} token; do not pass `/vault/attachments/...` paths, `/api/files/...` URLs, or markdown there. When delegating image editing to a subagent, always include the fileId in the task or instructions so the subagent can pass it to references. After the tool returns, always display each generated image to the user using markdown: ![description](/api/files/{fileId}/content) where {fileId} is from the images array in the output.',
    domain: 'native',
    execute: async (context, args) => {
      const references = await loadImageReferences(context, args.references)

      if (!references.ok) {
        return references
      }

      const operation = references.value.length > 0 ? 'edit' : 'generate'

      const generated = await context.services.ai.images.generate({
        aspectRatio: args.aspectRatio,
        imageSize: args.imageSize,
        operation,
        prompt: args.prompt,
        references: references.value,
      })

      if (!generated.ok) {
        return generated
      }

      if (generated.value.images.length === 0) {
        return err({
          message: 'Image generation completed without returning any images',
          provider: generated.value.provider,
          type: 'provider',
        })
      }

      const persisted = await persistGeneratedImages(context, {
        images: generated.value.images,
        metadata: {
          aspectRatio: args.aspectRatio ?? null,
          imageSize: args.imageSize ?? null,
          operation: generated.value.operation,
          prompt: args.prompt,
          provider: generated.value.provider,
          referenceFileIds: args.references?.map((reference) => reference.fileId) ?? [],
          resolvedModel: generated.value.model,
        },
      })

      if (!persisted.ok) {
        return persisted
      }

      return ok({
        kind: 'immediate' as const,
        output: {
          imageCount: persisted.value.length,
          images: persisted.value.map((file) => ({
            fileId: file.id,
            mimeType: file.mimeType,
            name: file.originalFilename ?? file.title ?? file.id,
            sizeBytes: file.sizeBytes,
          })),
          model: generated.value.model,
          provider: generated.value.provider,
        },
      })
    },
    inputSchema: {
      additionalProperties: false,
      properties: {
        aspectRatio: {
          description: 'Optional output aspect ratio for the generated image.',
          enum: imageAspectRatioSchema.options,
          type: 'string',
        },
        imageSize: {
          description: 'Optional output resolution tier. Gemini defaults to 1K.',
          enum: imageSizeSchema.options,
          type: 'string',
        },
        prompt: {
          description: 'Detailed image prompt describing the desired output.',
          type: 'string',
        },
        references: {
          description:
            'Image files to use as the base for editing. Providing references switches the operation from generation to editing. Use fileId values from previous generate_image output or attachment ref tokens from user-uploaded images. Do not pass `/vault/...` paths or `/api/files/...` URLs here.',
          items: {
            additionalProperties: false,
            properties: {
              fileId: {
                description:
                  'The fileId of the image to edit. Use a fileId from a previous generate_image output, or an attachment ref token (e.g. {{attachment:msg_...:kind:image:index:1}}) which resolves to a fileId automatically. Do not pass `/vault/attachments/...` paths, `/api/files/...` URLs, or markdown here.',
                type: 'string',
              },
            },
            required: ['fileId'],
            type: 'object',
          },
          type: 'array',
        },
      },
      required: ['prompt'],
      type: 'object',
    },
    isAvailable: (context) =>
      context.services.ai.images.isOperationAvailable('generate') &&
      isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'generate_image'),
    name: 'generate_image',
    strict: true,
    validateArgs: (args) => toValidationResult(generateImageArgsSchema.safeParse(args ?? {})),
  }

  toolRegistry.register(delegateToAgentTool as ToolSpec)
  toolRegistry.register(suspendRunTool as ToolSpec)
  toolRegistry.register(resumeDelegatedRunTool as ToolSpec)
  toolRegistry.register(getGardenContextTool as ToolSpec)
  toolRegistry.register(searchToolsTool as ToolSpec)
  toolRegistry.register(getToolsTool as ToolSpec)
  toolRegistry.register(generateImageTool as ToolSpec)
}
