<script lang="ts">
import { tryGetPreviewContext } from '../preview/preview-context'
import {
  buildStructuredMarkdown,
  type StructuredMarkdownBlock,
  type StructuredMarkdownInlineNode,
  type StructuredMarkdownListItem,
} from '../services/markdown/structural-markdown'
import { createMarkdownActions } from './markdown-actions'

interface Props {
  source?: string
  highlight?: boolean
  appendCaret?: boolean
  className?: string
}

let { source = '', highlight = false, appendCaret = false, className = '' }: Props = $props()

const attachMarkdownActions = createMarkdownActions(tryGetPreviewContext())
const blocks = $derived(buildStructuredMarkdown(source, { highlight }))

const textParts = (text: string): string[] => text.split('\n')
</script>

<div class={`md-body ${className}`.trim()} use:attachMarkdownActions={source}>
  {#if blocks.length === 0}
    {#if appendCaret}
      <span class="caret-blink" aria-hidden="true"></span>
    {/if}
  {:else}
    {@render renderBlocks(blocks, appendCaret)}
  {/if}
</div>

{#snippet renderBlocks(nodes: StructuredMarkdownBlock[], appendCaretToLast: boolean)}
  {#each nodes as node, index (node.id)}
    {@render renderBlock(node, appendCaretToLast && index === nodes.length - 1)}
  {/each}
{/snippet}

{#snippet renderBlock(node: StructuredMarkdownBlock, appendCaretHere: boolean)}
  {#if node.kind === 'paragraph'}
    <p>{@render renderInlines(node.inlines, appendCaretHere)}</p>
  {:else if node.kind === 'heading'}
    {#if node.depth === 1}
      <h1>{@render renderInlines(node.inlines, appendCaretHere)}</h1>
    {:else if node.depth === 2}
      <h2>{@render renderInlines(node.inlines, appendCaretHere)}</h2>
    {:else if node.depth === 3}
      <h3>{@render renderInlines(node.inlines, appendCaretHere)}</h3>
    {:else if node.depth === 4}
      <h4>{@render renderInlines(node.inlines, appendCaretHere)}</h4>
    {:else if node.depth === 5}
      <h5>{@render renderInlines(node.inlines, appendCaretHere)}</h5>
    {:else}
      <h6>{@render renderInlines(node.inlines, appendCaretHere)}</h6>
    {/if}
  {:else if node.kind === 'blockquote'}
    <blockquote>{@render renderBlocks(node.children, appendCaretHere)}</blockquote>
  {:else if node.kind === 'list'}
    {#if node.ordered}
      <ol start={node.start}>
        {@render renderListItems(node.items, appendCaretHere)}
      </ol>
    {:else}
      <ul>
        {@render renderListItems(node.items, appendCaretHere)}
      </ul>
    {/if}
  {:else if node.kind === 'code'}
    <div class="sd-code-block" data-code-block data-language={node.model.label}>
      <div class="sd-code-header">
        <span class="sd-code-language">{node.model.label}</span>
        <div class="sd-code-actions">
          <button class="sd-code-button" type="button" data-copy-code>Copy</button>
          <button class="sd-code-button" type="button" data-download-code>Download</button>
        </div>
      </div>
      <pre class="code-shell"><code class={`hljs language-${node.model.language}`}>{#if node.model.highlightedLines.length > 0}{#each node.model.highlightedLines as line, index (`${node.id}:line:${index}`)}{@html line}{/each}{:else}{#each node.model.lines as line, index (`${node.id}:line:${index}`)}<span class="line">{line}</span>{/each}{/if}{#if appendCaretHere}<span class="caret-blink" aria-hidden="true"></span>{/if}</code></pre>
    </div>
  {:else if node.kind === 'table'}
    <div class="md-table-wrap">
      <table>
        <thead>
          <tr>
            {#each node.header as cell, index (cell.id)}
              <th style:text-align={cell.align ?? undefined}>
                {@render renderInlines(cell.inlines, appendCaretHere && node.rows.length === 0 && index === node.header.length - 1)}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each node.rows as row, rowIndex (`${node.id}:row:${rowIndex}`)}
            <tr>
              {#each row as cell, cellIndex (cell.id)}
                <td style:text-align={cell.align ?? undefined}>
                  {@render renderInlines(cell.inlines, appendCaretHere && rowIndex === node.rows.length - 1 && cellIndex === row.length - 1)}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if node.kind === 'hr'}
    <hr />
    {#if appendCaretHere}
      <span class="caret-blink" aria-hidden="true"></span>
    {/if}
  {/if}
{/snippet}

{#snippet renderListItems(items: StructuredMarkdownListItem[], appendCaretToLast: boolean)}
  {#each items as item, index (item.id)}
    {@render renderListItem(item, appendCaretToLast && index === items.length - 1)}
  {/each}
{/snippet}

{#snippet renderListItem(item: StructuredMarkdownListItem, appendCaretHere: boolean)}
  <li>
    {#if item.task}
      <input type="checkbox" checked={item.checked} disabled />
    {/if}
    {#if item.inlines.length > 0}
      {@render renderInlines(item.inlines, appendCaretHere && item.blocks.length === 0)}
    {/if}
    {#if item.blocks.length > 0}
      {@render renderBlocks(item.blocks, appendCaretHere)}
    {/if}
    {#if appendCaretHere && item.inlines.length === 0 && item.blocks.length === 0}
      <span class="caret-blink" aria-hidden="true"></span>
    {/if}
  </li>
{/snippet}

{#snippet renderInlines(nodes: StructuredMarkdownInlineNode[], appendCaretAtEnd: boolean)}
  {#each nodes as node (node.id)}
    {@render renderInline(node)}
  {/each}
  {#if appendCaretAtEnd}
    <span class="caret-blink" aria-hidden="true"></span>
  {/if}
{/snippet}

{#snippet renderInline(node: StructuredMarkdownInlineNode)}
  {#if node.kind === 'text'}
    {@const parts = textParts(node.text)}
    {#each parts as part, index (`${node.id}:part:${index}`)}
      {part}
      {#if index < parts.length - 1}
        <br />
      {/if}
    {/each}
  {:else if node.kind === 'group'}
    {@render renderInlines(node.children, false)}
  {:else if node.kind === 'strong'}
    <strong>{@render renderInlines(node.children, false)}</strong>
  {:else if node.kind === 'em'}
    <em>{@render renderInlines(node.children, false)}</em>
  {:else if node.kind === 'del'}
    <del>{@render renderInlines(node.children, false)}</del>
  {:else if node.kind === 'codespan'}
    <code>{node.text}</code>
  {:else if node.kind === 'file-mention'}
    <span class="sd-file-mention" data-file-mention data-source="workspace" title={`#${node.text}`}><span class="sd-file-mention-prefix" aria-hidden="true">#</span><span class="sd-file-mention-label">{node.text}</span></span>
  {:else if node.kind === 'agent-mention'}
    <span class="sd-agent-mention" data-agent-mention title={`@${node.text}`}><span class="sd-agent-mention-prefix" aria-hidden="true">@</span><span class="sd-agent-mention-label">{node.text}</span></span>
  {:else if node.kind === 'link'}
    {#if node.href}
      <a href={node.href} title={node.title ?? undefined} target="_blank" rel="noopener noreferrer">
        {@render renderInlines(node.children, false)}
      </a>
    {:else}
      <span>{@render renderInlines(node.children, false)}</span>
    {/if}
  {:else if node.kind === 'image'}
    {#if node.src}
      <span class="sd-message-image" data-message-image data-image-alt={node.alt || 'Image'} data-image-src={node.src}>
        <img src={node.src} alt={node.alt} title={node.title ?? undefined} loading="lazy" decoding="async" />
        <span class="sd-message-image-actions">
          <button type="button" class="sd-message-image-button" data-copy-image>Copy</button>
          <button type="button" class="sd-message-image-button" data-download-image>Download</button>
        </span>
      </span>
    {:else}
      <span>{node.alt}</span>
    {/if}
  {:else if node.kind === 'br'}
    <br />
  {/if}
{/snippet}
