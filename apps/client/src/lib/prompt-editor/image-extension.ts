import { mergeAttributes, Node } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

const NON_IMAGE_HOSTS =
  /^https?:\/\/(www\.)?(vimeo\.com|youtube\.com|youtu\.be|twitter\.com|x\.com)\//i

const IMAGE_MD_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g

interface ExpandedImageRange {
  from: number
  hasAfter: boolean
  hasBefore: boolean
  to: number
}

type ImageInlineEditMeta = { clear: true } | { expanded: ExpandedImageRange }
type ImageMarkdownAttributes = {
  alt?: string | null
  src?: string | null
  title?: string | null
}
type ImageMarkdownMatch = {
  attrs: ImageMarkdownAttributes
  from: number
  to: number
}

const imageInlineEditKey = new PluginKey<ExpandedImageRange | null>('imageInlineEdit')

const escapeMarkdownText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')

const escapeMarkdownTitle = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

const findImageMarkdownAtSelection = (
  doc: ProseMirrorNode,
  selection: TextSelection,
): ImageMarkdownMatch | null => {
  let result: ImageMarkdownMatch | null = null

  doc.descendants((node, pos) => {
    if (result || !node.isText || !node.text) {
      return result ? false : undefined
    }

    if (selection.from < pos || selection.from > pos + node.text.length) {
      return
    }

    IMAGE_MD_RE.lastIndex = 0
    let match: RegExpExecArray | null = IMAGE_MD_RE.exec(node.text)
    while (match) {
      const from = pos + match.index
      const to = from + match[0].length

      if (selection.from >= from && selection.from <= to) {
        result = {
          attrs: {
            alt: match[1] || '',
            src: match[2],
            title: match[3] || null,
          },
          from,
          to,
        }
        return false
      }

      match = IMAGE_MD_RE.exec(node.text)
    }
  })

  return result
}

export const PromptImage = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      title: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'img[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const src = typeof HTMLAttributes.src === 'string' ? HTMLAttributes.src : ''
    if (NON_IMAGE_HOSTS.test(src)) {
      const alt = HTMLAttributes.alt || src
      return ['a', { href: src, target: '_blank', rel: 'noreferrer' }, alt]
    }
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addProseMirrorPlugins() {
    const imageType = this.type
    let verticalArrow = false

    return [
      new Plugin({
        key: imageInlineEditKey,
        state: {
          init: () => null,
          apply(tr, value: ExpandedImageRange | null) {
            const meta = tr.getMeta(imageInlineEditKey) as ImageInlineEditMeta | undefined

            if (meta && 'clear' in meta) {
              return null
            }

            if (meta && 'expanded' in meta) {
              return meta.expanded
            }

            if (!value) {
              return null
            }

            const mappedFrom = tr.mapping.mapResult(value.from, -1)
            const mappedTo = tr.mapping.mapResult(value.to, 1)

            if (mappedFrom.deleted || mappedTo.deleted || mappedFrom.pos >= mappedTo.pos) {
              return null
            }

            return {
              ...value,
              from: mappedFrom.pos,
              to: mappedTo.pos,
            }
          },
        },
        props: {
          handleKeyDown(view, event) {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              verticalArrow = true
              return false
            }

            if (
              (event.key === 'Enter' || event.key === 'Backspace') &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey &&
              view.state.selection instanceof TextSelection &&
              view.state.selection.empty
            ) {
              const { $from } = view.state.selection
              const nodeAfter = $from.nodeAfter
              const nodeBefore = $from.nodeBefore

              if (nodeAfter?.type === imageType) {
                if (event.key === 'Enter') {
                  const hardBreakType = view.state.schema.nodes.hardBreak
                  if (!hardBreakType) {
                    return false
                  }

                  const tr = view.state.tr.insert(view.state.selection.from, hardBreakType.create())
                  tr.setSelection(TextSelection.create(tr.doc, view.state.selection.from + 1))
                  view.dispatch(tr.scrollIntoView())
                  event.preventDefault()
                  return true
                }

                if (event.key === 'Backspace' && nodeBefore?.type.name === 'hardBreak') {
                  const from = view.state.selection.from - nodeBefore.nodeSize
                  const tr = view.state.tr.delete(from, view.state.selection.from)
                  tr.setSelection(TextSelection.create(tr.doc, from))
                  view.dispatch(tr.scrollIntoView())
                  event.preventDefault()
                  return true
                }
              }
            }

            if (
              event.key !== 'Enter' ||
              event.metaKey ||
              event.ctrlKey ||
              event.altKey ||
              !(view.state.selection instanceof TextSelection) ||
              !view.state.selection.empty
            ) {
              return false
            }

            const match = findImageMarkdownAtSelection(view.state.doc, view.state.selection)
            if (!match) {
              return false
            }

            const cursorAtMarkdownStart = view.state.selection.from === match.from
            const tr = view.state.tr
            const hardBreakType = view.state.schema.nodes.hardBreak
            const imageNode = imageType.create({
              alt: match.attrs.alt || '',
              src: match.attrs.src || '',
              title: match.attrs.title || null,
            })

            if (cursorAtMarkdownStart) {
              const replacementNodes: ProseMirrorNode[] = hardBreakType
                ? [hardBreakType.create(), imageNode]
                : [imageNode]

              tr.replaceWith(match.from, match.to, replacementNodes)

              const selectionPos = match.from + (hardBreakType ? 1 : 0)
              tr.setSelection(TextSelection.create(tr.doc, selectionPos))
              tr.setMeta(imageInlineEditKey, { clear: true } satisfies ImageInlineEditMeta)
              view.dispatch(tr.scrollIntoView())
              event.preventDefault()
              return true
            }

            let replaceFrom = match.from
            let replaceTo = match.to

            const $start = tr.doc.resolve(match.from)
            if ($start.nodeBefore?.type.name === 'hardBreak') {
              replaceFrom -= $start.nodeBefore.nodeSize
            }

            const $end = tr.doc.resolve(match.to)
            if ($end.nodeAfter?.type.name === 'hardBreak') {
              replaceTo += $end.nodeAfter.nodeSize
            }

            tr.replaceWith(replaceFrom, replaceTo, imageNode)
            const insertPos = replaceFrom + imageNode.nodeSize

            if (hardBreakType) {
              tr.insert(insertPos, hardBreakType.create())
              tr.setSelection(TextSelection.create(tr.doc, insertPos + 1))
            } else {
              tr.setSelection(TextSelection.create(tr.doc, insertPos))
            }

            tr.setMeta(imageInlineEditKey, { clear: true } satisfies ImageInlineEditMeta)
            view.dispatch(tr.scrollIntoView())
            event.preventDefault()
            return true
          },
        },
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null

          const wasVerticalArrow = verticalArrow
          verticalArrow = false
          const expandedImage = imageInlineEditKey.getState(newState)

          const { selection, schema } = newState

          const expandImage = (from: number, _to: number, attrs: ImageMarkdownAttributes) => {
            const { alt = '', src = '', title = null } = attrs
            const titlePart = title ? ` "${title}"` : ''
            const md = `![${alt}](${src}${titlePart})`
            const tr = newState.tr
            const hardBreakType = schema.nodes.hardBreak

            const $from = newState.doc.resolve(from)
            const parent = $from.parent
            const offset = $from.parentOffset
            const afterOffset = offset + 1 // image atom = 1 position
            const hasBefore = offset > 0 && Boolean(hardBreakType)
            const hasAfter = afterOffset < parent.content.size && Boolean(hardBreakType)

            const replacementNodes: ProseMirrorNode[] = []
            if (hasBefore && hardBreakType) {
              replacementNodes.push(hardBreakType.create())
            }
            replacementNodes.push(schema.text(md))
            if (hasAfter && hardBreakType) {
              replacementNodes.push(hardBreakType.create())
            }

            tr.replaceWith(from, from + 1, replacementNodes)

            const markdownFrom = from + (hasBefore ? 1 : 0)
            const markdownTo = markdownFrom + md.length

            tr.setMeta(imageInlineEditKey, {
              expanded: {
                from: markdownFrom,
                hasAfter,
                hasBefore,
                to: markdownTo,
              },
            } satisfies ImageInlineEditMeta)

            // Cursor inside "![" — skip any "before" block
            tr.setSelection(TextSelection.create(tr.doc, markdownFrom + 2))

            return tr
          }

          // NodeSelection on image (left/right arrows, click)
          if (selection instanceof NodeSelection && selection.node.type === imageType) {
            return expandImage(selection.from, selection.to, selection.node.attrs)
          }

          // TextSelection adjacent to image (up/down, click near image)
          const pureNav = transactions.every((tr) => !tr.docChanged)
          if (pureNav && selection instanceof TextSelection && selection.empty) {
            const $pos = selection.$from
            if ($pos.nodeAfter?.type === imageType) {
              const from = $pos.pos
              return expandImage(from, from + $pos.nodeAfter.nodeSize, $pos.nodeAfter.attrs)
            }
            if ($pos.nodeBefore?.type === imageType) {
              const to = $pos.pos
              return expandImage(to - $pos.nodeBefore.nodeSize, to, $pos.nodeBefore.attrs)
            }

            // Up/down arrow jumped over an image — scan between old and new positions
            if (wasVerticalArrow) {
              const oldPos = oldState.selection.from
              const newPos = selection.from
              const scanFrom = Math.min(oldPos, newPos)
              const scanTo = Math.max(oldPos, newPos)
              let foundPos = -1
              let foundNodeSize = 0
              let foundAttrs: ImageMarkdownAttributes | null = null
              newState.doc.nodesBetween(scanFrom, scanTo, (node, pos) => {
                if (node.type === imageType && foundPos < 0) {
                  foundPos = typeof pos === 'number' ? pos : Number(pos)
                  foundNodeSize = node.nodeSize
                  foundAttrs = {
                    alt: typeof node.attrs.alt === 'string' ? node.attrs.alt : null,
                    src: typeof node.attrs.src === 'string' ? node.attrs.src : null,
                    title: typeof node.attrs.title === 'string' ? node.attrs.title : null,
                  }
                  return false
                }
              })
              if (foundPos >= 0 && foundAttrs) {
                return expandImage(foundPos, foundPos + foundNodeSize, foundAttrs)
              }
            }
          }

          // Convert ![...](...)  text back to image nodes when cursor is outside
          const tr = newState.tr
          let modified = false

          newState.doc.descendants((node, pos) => {
            if (modified) return false
            if (node.type.name === 'codeBlock') return false
            if (!node.isText || !node.text) return
            if (node.marks.some((m) => m.type.name === 'code')) return

            IMAGE_MD_RE.lastIndex = 0
            let match: RegExpExecArray | null = IMAGE_MD_RE.exec(node.text)
            while (match) {
              const from = pos + match.index
              const to = from + match[0].length
              if (selection.from >= from && selection.from <= to) {
                match = IMAGE_MD_RE.exec(node.text)
                continue
              }
              if (selection.to >= from && selection.to <= to) {
                match = IMAGE_MD_RE.exec(node.text)
                continue
              }

              const imageNode = imageType.create({
                alt: match[1] || '',
                src: match[2],
                title: match[3] || null,
              })
              const trackedExpansion =
                expandedImage && expandedImage.from === from && expandedImage.to === to
                  ? expandedImage
                  : null
              let replaceFrom = from
              let replaceTo = to

              const $start = tr.doc.resolve(from)
              if (
                (trackedExpansion?.hasBefore || $start.nodeBefore?.type.name === 'hardBreak') &&
                $start.nodeBefore?.type.name === 'hardBreak'
              ) {
                replaceFrom -= $start.nodeBefore.nodeSize
              }

              const $end = tr.doc.resolve(to)
              if (
                (trackedExpansion?.hasAfter || $end.nodeAfter?.type.name === 'hardBreak') &&
                $end.nodeAfter?.type.name === 'hardBreak'
              ) {
                replaceTo += $end.nodeAfter.nodeSize
              }

              tr.replaceWith(replaceFrom, replaceTo, imageNode)

              if (trackedExpansion) {
                tr.setMeta(imageInlineEditKey, { clear: true } satisfies ImageInlineEditMeta)
              }

              modified = true
              return false
            }
          })

          return modified ? tr : null
        },
      }),
    ]
  },

  markdownTokenName: 'image',

  parseMarkdown(token, helpers) {
    return helpers.createNode('image', {
      src: token.href ?? '',
      alt: token.text ?? '',
      title: token.title ?? null,
    })
  },

  renderMarkdown(node) {
    const src = typeof node.attrs?.src === 'string' ? node.attrs.src.trim() : ''
    if (!src) return ''

    const alt = typeof node.attrs?.alt === 'string' ? escapeMarkdownText(node.attrs.alt) : ''
    const title =
      typeof node.attrs?.title === 'string' && node.attrs.title.trim().length > 0
        ? ` "${escapeMarkdownTitle(node.attrs.title)}"`
        : ''

    return `![${alt}](${src}${title})`
  },
})
