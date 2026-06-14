import { describe, expect, test } from 'vitest'
import { renderMarkdown } from './markdown.js'

const snapshot = (value: string): string => value.trim().replace(/\r\n/g, '\n')

describe('renderMarkdown', () => {
  test('renders fenced code blocks with actions and language metadata', () => {
    const html = renderMarkdown('```ts\nconst value = 42\n```')

    expect(snapshot(html)).toBe(
      snapshot(
        [
          '<div class="sd-code-block" data-code-block data-language="typescript"><div class="sd-code-header"><span class="sd-code-language">typescript</span><div class="sd-code-actions"><button class="sd-code-button" type="button" data-copy-code>Copy</button><button class="sd-code-button" type="button" data-download-code>Download</button></div></div><pre class="code-shell" tabindex="0"><code class="hljs language-ts"><span class="line"><span class="hljs-keyword">const</span> value = <span class="hljs-number">42</span></span></code></pre></div>',
        ].join('\n'),
      ),
    )
  })

  test('adds target and rel attributes to links', () => {
    const html = renderMarkdown('[Docs](https://example.com)')

    expect(snapshot(html)).toBe(
      snapshot('<p><a href="https://example.com" target="_blank" rel="noreferrer">Docs</a></p>'),
    )
  })

  test('wraps tables and lazily loads images', () => {
    const html = renderMarkdown(
      ['| a | b |', '| - | - |', '| 1 | 2 |', '', '![Alt](https://example.com/image.png)'].join(
        '\n',
      ),
    )

    expect(snapshot(html)).toBe(
      snapshot(
        [
          '<div class="md-table-wrap"><table>',
          '<thead>',
          '<tr>',
          '<th>a</th>',
          '<th>b</th>',
          '</tr>',
          '</thead>',
          '<tbody>',
          '<tr>',
          '<td>1</td>',
          '<td>2</td>',
          '</tr>',
          '</tbody>',
          '</table>',
          '</div><p><img src="https://example.com/image.png" alt="Alt" loading="lazy" decoding="async"></p>',
        ].join('\n'),
      ),
    )
  })

  test('normalizes autolink-corrupted markdown image urls before rendering', () => {
    const html = renderMarkdown(
      '![Alt]([https://example.com/image.png](https://example.com/image.png))',
    )

    expect(snapshot(html)).toBe(
      snapshot(
        '<p><img src="https://example.com/image.png" alt="Alt" loading="lazy" decoding="async"></p>',
      ),
    )
  })

  test('does not fuzzy-link bare filenames or hash-prefixed file references', () => {
    expect(snapshot(renderMarkdown('file.md'))).toBe(snapshot('<p>file.md</p>'))
    expect(snapshot(renderMarkdown('#file.md'))).toBe(snapshot('<p>#file.md</p>'))
    expect(snapshot(renderMarkdown('https://example.com'))).toBe(
      snapshot(
        '<p><a href="https://example.com" target="_blank" rel="noreferrer">https://example.com</a></p>',
      ),
    )
  })

  test('renders serialized file references as dedicated inline file tokens in messages', () => {
    expect(snapshot(renderMarkdown('Review `#src/index.ts` and `#Project Plan.pdf`'))).toBe(
      snapshot(
        '<p>Review <span class="sd-file-mention" data-file-mention data-source="workspace" title="#src/index.ts"><span class="sd-file-mention-prefix" aria-hidden="true">#</span><span class="sd-file-mention-label">src/index.ts</span></span> and <span class="sd-file-mention" data-file-mention data-source="workspace" title="#Project Plan.pdf"><span class="sd-file-mention-prefix" aria-hidden="true">#</span><span class="sd-file-mention-label">Project Plan.pdf</span></span></p>',
      ),
    )
  })

  test('renders serialized agent references as dedicated inline agent tokens in messages', () => {
    expect(snapshot(renderMarkdown('Ask `@researcher` to review this.'))).toBe(
      snapshot(
        '<p>Ask <span class="sd-agent-mention" data-agent-mention title="@researcher"><span class="sd-agent-mention-prefix" aria-hidden="true">@</span><span class="sd-agent-mention-label">researcher</span></span> to review this.</p>',
      ),
    )
  })

  test('injects the caret into the last textual block when requested', () => {
    const html = renderMarkdown('Hello world', { appendCaret: true, highlight: true })

    expect(snapshot(html)).toBe(
      snapshot('<p>Hello world<span class="caret-blink" aria-hidden="true"></span></p>'),
    )
  })
})
