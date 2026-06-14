import type { AttachmentRefDescriptor } from '../files/attachment-ref-context'
import type { AttachmentRefAccessMode } from './attachment-ref-access'

interface AttachmentRefPromptOptions {
  accessMode: AttachmentRefAccessMode
  includeExecuteHint?: boolean
  includeGenerateImageHint?: boolean
  includeJustBashHint?: boolean
}

const toStableRulesText = (options: AttachmentRefPromptOptions): string =>
  [
    'Attachment refs:',
    '',
    '- Attachments in each user message have message-scoped refs and ordinals.',
    '- Use refs when you need to point to a file precisely in tool calls or delegated tasks.',
    '- image[2] means the second image in that message.',
    '- attachment[3] means the third attachment of any kind in that message.',
    '- attachment[n], file[n], and image[n] are reasoning aliases only. Do not pass them literally to tools.',
    '- In tool arguments, use the full {{attachment:...}} token shown below.',
    '- Refs stay human-readable; the server maps them to stable file ids.',
    ...(options.includeGenerateImageHint
      ? [
          '- For `generate_image.references[].fileId`, pass a real `fil_*` id or the full {{attachment:...}} token. Do not pass `/vault/attachments/...` paths, `/api/files/...` URLs, or markdown there.',
        ]
      : []),
    ...(options.accessMode === 'sandbox'
      ? [
          '- Sandbox access is available and takes priority over workspace file tools for attachment handling.',
          ...(options.includeExecuteHint
            ? [
                '- Pass attachment refs directly in execute.attachments[].fileId. The server resolves them to real file ids before validation.',
              ]
            : []),
          '- Staged attachment files appear under /input/... unless you override mountPath.',
          '- When authoring Garden content from an attachment, copy publishable files into public/** and reference them in markdown as /public/... or public/..., not as guessed live page URLs.',
          ...(options.includeJustBashHint
            ? [
                ...(options.includeExecuteHint
                  ? [
                      '- Use execute as the default choice for `find`, `rg`, `grep`, `ls`, `cat`, `head`, `tail`, `sed`, and simple pipes over mounted files. It defaults to `mode: "bash"` when mode is omitted.',
                      '- When a job sets `garden`, execute bash mode starts in that Garden source root (for example `/vault/overment`). Prefer relative paths from `pwd` like `_garden.yml` or `_meta/frontmatter.md`, and use absolute `/vault/...` paths only when a tool argument truly requires them.',
                      '- When a job sets `garden`, `outputs.writeBack[].toVaultPath: "."` targets that selected Garden root directly.',
                      '- execute bash mode uses just-bash, not host bash. Do not probe for system binaries like `magick`, `ffmpeg`, or `sips` with `which` there.',
                      '- For inline execute calls, prefer the flat form with top-level `script`, for example `{ "mode": "bash", "garden": "overment", "script": "grep -r \\"nora\\" . || true", "task": "Search for Nora" }`. Do not pass `source` as a bare string.',
                      '- execute bash mode is bash-like but not GNU-complete. Prefer conservative flags, avoid assuming options like `grep -H` or `grep -I` exist, and prefer direct recursive `grep` or `rg` over `find | while read ...` loops for simple searches.',
                      '- When a search may legitimately return no matches, append `|| true` so exit code `1` does not fail the whole execute call.',
                      '- For shell-style tasks over mounted files, prefer execute bash mode over hand-written just-bash wrapper code.',
                      '- Use execute with `mode: "script"` only when you need custom JavaScript, MCP code-mode scripts, npm packages, or structured parsing/transforms.',
                      '- In execute `mode: "script"`, inline JavaScript normally runs as an ES module. Prefer `await import(...)`, avoid `require(...)`, and outside MCP code mode do not use top-level `return`. When MCP code mode is active, write a script body, not a full module: the runtime wraps your code in an async function, so `return` is allowed there but static top-level `import`/`export` is not.',
                      '- Sandbox edits remain staged until you request `outputs.writeBack` and later apply them with `commit_sandbox_writeback`.',
                    ]
                  : [
                      '- For shell-style tasks over mounted files, prefer just-bash instead of writing a custom fs walker.',
                      '- just-bash is already available by default in sandbox jobs. Do not add it in packages[].',
                      '- Use just-bash for find/grep/ls/cat/head/tail over /input or /vault, and do not spawn bash via child_process.',
                      '- `new Bash()` is in-memory only; to inspect mounted files, use OverlayFs on the mounted root. Example: `import { Bash, OverlayFs } from "just-bash"; const fs = new OverlayFs({ root: "/input", readOnly: true }); const bash = new Bash({ fs, cwd: fs.getMountPoint() }); console.log((await bash.exec("find . -maxdepth 2 -type f")).stdout);`',
                    ]),
                '- /input exists only for staged attachments. /vault paths exist in the sandbox only if the job mounts them with vaultInputs or cwdVaultPath.',
                '- Use raw fs/path code only when you need structured parsing, transforms, or JSON processing.',
              ]
            : []),
        ]
      : options.accessMode === 'workspace_files'
        ? [
            '- Workspace file tools can read attachments at the /vault/attachments/... paths shown below.',
            '- Use fs_read or fs_search with those /vault paths when you need to inspect attachment files.',
          ]
        : [
            '- Direct sandbox or workspace-files access is not available for this run.',
            '- For ordinary tools, a standalone ref string resolves to a file URL; inline refs inside larger strings resolve to file contents or image markdown.',
          ]),
  ].join('\n')

const groupDescriptorsByMessage = (
  descriptors: AttachmentRefDescriptor[],
): Array<{
  descriptors: AttachmentRefDescriptor[]
  messageCreatedAt: string
  messageId: string
  messageSequence: number
  sourceMessageState: AttachmentRefDescriptor['sourceMessageState']
}> => {
  const groups = new Map<
    string,
    {
      descriptors: AttachmentRefDescriptor[]
      messageCreatedAt: string
      messageId: string
      messageSequence: number
      sourceMessageState: AttachmentRefDescriptor['sourceMessageState']
    }
  >()

  for (const descriptor of descriptors) {
    const existing = groups.get(descriptor.messageId)

    if (existing) {
      existing.descriptors.push(descriptor)
      continue
    }

    groups.set(descriptor.messageId, {
      descriptors: [descriptor],
      messageCreatedAt: descriptor.messageCreatedAt,
      messageId: descriptor.messageId,
      messageSequence: descriptor.messageSequence,
      sourceMessageState: descriptor.sourceMessageState,
    })
  }

  return [...groups.values()].sort((left, right) => left.messageSequence - right.messageSequence)
}

const toDescriptorLines = (
  descriptors: AttachmentRefDescriptor[],
  options: AttachmentRefPromptOptions,
): string[] =>
  descriptors.flatMap((descriptor) => {
    const selectors = [`attachment[${descriptor.indexInMessageAll}]`]

    if (descriptor.kind === 'image') {
      selectors.unshift(`image[${descriptor.indexInMessageByKind}]`)
    } else {
      selectors.unshift(`file[${descriptor.indexInMessageByKind}]`)
    }

    const name = descriptor.name ? ` (${descriptor.name})` : ''
    const detailLine =
      options.accessMode === 'sandbox'
        ? '  sandbox: use this ref in execute.attachments[].fileId; it will mount under /input/...'
        : options.accessMode === 'workspace_files'
          ? `  path: ${descriptor.internalPath}`
          : `  url: ${descriptor.renderUrl}`
    const generateImageLine = options.includeGenerateImageHint
      ? '  generate_image: pass this tool ref in references[].fileId, or a real fil_* id. Do not pass the path or URL variant there.'
      : null

    return selectors.map((selector, index) => {
      if (index !== 0) {
        return `- ${selector} alias -> tool ref ${descriptor.ref}${name}`
      }

      const detailLines = [detailLine, generateImageLine].filter(
        (value): value is string => value !== null,
      )

      return `- ${selector} alias -> tool ref ${descriptor.ref}${name}\n${detailLines.join('\n')}`
    })
  })

export const formatAttachmentRefRulesDeveloperMessage = (
  descriptors: AttachmentRefDescriptor[],
  options: AttachmentRefPromptOptions,
): string => (descriptors.length > 0 ? toStableRulesText(options) : '')

export const formatAttachmentRefContextDeveloperMessage = (
  descriptors: AttachmentRefDescriptor[],
  options: AttachmentRefPromptOptions,
): string => {
  if (descriptors.length === 0) {
    return ''
  }

  return groupDescriptorsByMessage(descriptors)
    .map((group) =>
      [
        group.sourceMessageState === 'sealed'
          ? `Attachment refs from earlier sealed message ${group.messageId}:`
          : `Attachment refs for visible message ${group.messageId}:`,
        '',
        ...toDescriptorLines(group.descriptors, options),
      ].join('\n'),
    )
    .join('\n\n')
}
