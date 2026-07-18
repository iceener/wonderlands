import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { onTestFinished, test } from 'vitest'
import {
  buildGardenSite,
  compileGardenBuildOutput,
  computeGardenSourceFingerprint,
  writeGardenBuildOutput,
} from '../src/application/garden/compiler/build-site'
import { resolveGardenSourceScope } from '../src/application/garden/compiler/resolve-source-path'

const writeTextFile = (absolutePath: string, contents: string) => {
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, contents, 'utf8')
}

const createVaultFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'garden-compiler-'))
  const vaultRootRef = join(dir, 'vault')

  mkdirSync(vaultRootRef, { recursive: true })

  return {
    dir,
    vaultRootRef,
  }
}

test('resolveGardenSourceScope normalizes valid scope paths and rejects traversal', async () => {
  const fixture = createVaultFixture()

  onTestFinished(() => {
    rmSync(fixture.dir, { force: true, recursive: true })
  })

  writeTextFile(
    join(fixture.vaultRootRef, 'site', '_garden.yml'),
    `schema: garden/v1
public:
  roots:
    - index.md
`,
  )

  const resolved = await resolveGardenSourceScope({
    sourceScopePath: 'site/./',
    vaultRootRef: fixture.vaultRootRef,
  })

  assert.equal(resolved.ok, true)

  if (!resolved.ok) {
    return
  }

  assert.equal(resolved.value.sourceScopePath, 'site')
  assert.match(resolved.value.sourceScopeRef, /site$/)

  const escaped = await resolveGardenSourceScope({
    sourceScopePath: '../outside',
    vaultRootRef: fixture.vaultRootRef,
  })

  assert.equal(escaped.ok, false)

  if (!escaped.ok) {
    assert.equal(escaped.error.type, 'validation')
    assert.match(escaped.error.message, /source_scope_path/)
  }
})

test('buildGardenSite classifies pages, emits warnings, and writes separated artifacts', async () => {
  const fixture = createVaultFixture()
  const sourceScopeRef = join(fixture.vaultRootRef, 'site')
  const outputRootRef = join(fixture.dir, 'out')

  onTestFinished(() => {
    rmSync(fixture.dir, { force: true, recursive: true })
  })

  writeTextFile(
    join(sourceScopeRef, '_garden.yml'),
    `schema: garden/v1
title: Test Garden
navigation:
  - label: Home
    path: /
  - label: Signal
    path: /signal
public:
  roots:
    - index.md
    - signal
  exclude:
    - signal/secret
listing:
  default_page_size: 10
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: Home
---
Welcome to [[signal]].

Protected: [[signal/protected-note]]

Hidden: [Secret](signal/secret.md)

Missing: [[missing-page]]

[Logo](public/logo.txt)
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'signal.md'),
    `---
title: Signal
listing: true
---
Signal landing page.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'signal', 'post-a.md'),
    `---
title: Post A
description: Public post
excerpt: Short post summary
date: 2026-04-01
tags: [books, strategy]
cover_image: /public/covers/post-a.jpg
order: 20
---
Hello from post A.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'signal', 'post-b.md'),
    `---
title: Post B
description: Featured post description
excerpt: Ordered excerpt
date: 2026-04-03
tags: featured, launches
cover_image: public/covers/post-b.jpg
order: 10
---
Hello from post B.

![Inline asset](/covers/post-b.jpg)

## Details

Extra notes.

### Subdetails

More notes.

## Wrap Up

Closing notes.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'signal', 'post-z.md'),
    `---
title: Post Z
description: Fallback listing description
date: 2026-03-30
---
Hello from post Z.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'signal', 'protected-note.md'),
    `---
title: Protected Note
visibility: protected
date: 2026-04-02
---
Protected details.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'signal', 'secret.md'),
    `---
title: Secret
---
Should not publish.
`,
  )

  writeTextFile(
    join(sourceScopeRef, '_meta', 'frontmatter.md'),
    `# Helper

Should stay private.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'attachments', 'leak.md'),
    `---
title: [Leak
---
Should stay private.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'system', 'ops.md'),
    `---
title: [Ops
---
Should stay private.
`,
  )

  writeTextFile(join(sourceScopeRef, 'public', 'logo.txt'), 'logo asset')
  writeTextFile(join(sourceScopeRef, 'public', 'covers', 'post-a.jpg'), 'post-a cover')
  writeTextFile(join(sourceScopeRef, 'public', 'covers', 'post-b.jpg'), 'post-b cover')

  const built = await buildGardenSite({
    sourceScopePath: 'site',
    vaultRootRef: fixture.vaultRootRef,
  })

  assert.equal(built.ok, true)

  if (!built.ok) {
    return
  }

  const fingerprint = await computeGardenSourceFingerprint({
    sourceScopePath: 'site',
    vaultRootRef: fixture.vaultRootRef,
  })

  assert.equal(fingerprint.ok, true)

  if (!fingerprint.ok) {
    return
  }

  assert.equal(fingerprint.value, built.value.manifest.sourceFingerprintSha256)

  assert.equal(built.value.manifest.publicPageCount, 5)
  assert.equal(built.value.manifest.protectedPageCount, 1)
  assert.deepEqual(
    built.value.manifest.pages.map((page) => ({
      routePath: page.routePath,
      visibility: page.visibility,
    })),
    [
      { routePath: '/', visibility: 'public' },
      { routePath: '/signal', visibility: 'public' },
      { routePath: '/signal/post-a', visibility: 'public' },
      { routePath: '/signal/post-b', visibility: 'public' },
      { routePath: '/signal/post-z', visibility: 'public' },
      { routePath: '/signal/protected-note', visibility: 'protected' },
    ],
  )
  assert.equal(built.value.manifest.assets.length, 3)
  assert.deepEqual(
    built.value.manifest.assets.map((asset) => asset.artifactPath),
    ['public/covers/post-a.jpg', 'public/covers/post-b.jpg', 'public/logo.txt'],
  )
  assert.equal(built.value.manifest.search, undefined)
  assert.equal(built.value.manifest.warnings.length, 3)
  assert.match(
    built.value.manifest.warnings.map((warning) => warning.message).join('\n'),
    /excluded from the published garden/,
  )
  assert.match(
    built.value.manifest.warnings.map((warning) => warning.message).join('\n'),
    /could not be resolved/,
  )
  assert.match(
    built.value.manifest.warnings.map((warning) => warning.message).join('\n'),
    /Asset link "\/covers\/post-b\.jpg" should reference "\/public\/covers\/post-b\.jpg" in source markdown; rewriting automatically/,
  )

  const publicIndex = built.value.publicPages.find((page) => page.routePath === '/')
  const publicSignal = built.value.publicPages.find((page) => page.routePath === '/signal')
  const publicPostB = built.value.publicPages.find((page) => page.routePath === '/signal/post-b')
  const protectedPage = built.value.protectedPages.find(
    (page) => page.routePath === '/signal/protected-note',
  )

  assert.ok(publicIndex)
  assert.ok(publicSignal)
  assert.ok(publicPostB)
  assert.ok(protectedPage)

  if (!publicIndex || !publicSignal || !publicPostB || !protectedPage) {
    return
  }

  const postBManifest = built.value.manifest.pages.find(
    (page) => page.routePath === '/signal/post-b',
  )

  assert.deepEqual(postBManifest, {
    artifactPath: 'signal/post-b.html',
    coverImageArtifactPath: 'public/covers/post-b.jpg',
    description: 'Featured post description',
    excerpt: 'Ordered excerpt',
    order: 10,
    routePath: '/signal/post-b',
    sourcePath: 'signal/post-b.md',
    sourceSlug: 'signal/post-b',
    tags: ['featured', 'launches'],
    title: 'Post B',
    visibility: 'public',
  })
  assert.match(publicIndex.content, /class="garden-sidebar"/)
  assert.match(publicIndex.content, /data-garden-search-root/)
  assert.match(publicIndex.content, /garden-search-filter-count/)
  assert.match(publicIndex.content, /const normalizeSearchResultHref = \(value\) =>/)
  assert.match(publicIndex.content, /resolved\.pathname\.endsWith\('\.html'\)/)
  assert.match(publicIndex.content, /data-pagefind-body/)
  assert.doesNotMatch(publicIndex.content, /pagefind\.filters\(/)
  assert.match(publicIndex.content, />Home</)
  assert.match(publicIndex.content, />Signal</)
  assert.match(publicIndex.content, />Post A</)
  assert.match(publicIndex.content, />Post B</)
  assert.match(publicIndex.content, />Post Z</)
  assert.match(publicIndex.content, /data-garden-link="internal" href="\/signal"/)
  assert.match(publicIndex.content, /data-garden-link="internal" href="\/signal\/protected-note"/)
  assert.doesNotMatch(publicIndex.content, /href="signal\/secret"/)
  assert.match(publicIndex.content, /Hidden: Secret/)
  assert.match(publicIndex.content, /Missing: missing page/i)
  assert.match(publicIndex.content, /data-garden-link="internal" href="\/public\/logo\.txt"/)
  assert.match(publicSignal.content, /Ordered excerpt/)
  assert.match(publicSignal.content, /Short post summary/)
  assert.match(publicSignal.content, /Fallback listing description/)
  assert.ok(publicSignal.content.indexOf('Post B') < publicSignal.content.indexOf('Post A'))
  assert.ok(publicSignal.content.indexOf('Post A') < publicSignal.content.indexOf('Post Z'))
  assert.doesNotMatch(publicSignal.content, /Protected Note/)
  assert.match(publicPostB.content, /<meta name="description" content="Featured post description">/)
  assert.doesNotMatch(publicPostB.content, /class="page-description"/)
  assert.match(publicPostB.content, /class="page-tag"[^>]*>featured</)
  assert.match(publicPostB.content, /class="page-tag"[^>]*>launches</)
  assert.match(publicPostB.content, /class="page-cover"/)
  assert.match(
    publicPostB.content,
    /data-garden-link="internal" src="\/public\/covers\/post-b\.jpg"/,
  )
  assert.match(
    publicPostB.content,
    /<img alt="Inline asset" data-garden-link="internal" src="\/public\/covers\/post-b\.jpg"/,
  )
  assert.match(publicPostB.content, /data-pagefind-meta="excerpt:Ordered excerpt"/)
  assert.match(publicPostB.content, /aria-label="Table of contents"/)
  assert.match(publicPostB.content, /href="#details"/)
  assert.ok(
    publicPostB.content.indexOf('class="page-title"') <
      publicPostB.content.indexOf('aria-label="Table of contents"'),
  )
  assert.ok(
    publicPostB.content.indexOf('class="page-tags"') <
      publicPostB.content.indexOf('aria-label="Table of contents"'),
  )
  assert.match(publicPostB.content, /"sectionLabels":\{"signal":"Signal"\}/)
  assert.match(protectedPage.content, /Protected details/)

  const written = await writeGardenBuildOutput({
    build: built.value,
    outputRootRef,
  })

  assert.equal(written.ok, true)

  if (!written.ok) {
    return
  }

  assert.equal(written.value.search.enabled, true)
  assert.equal(written.value.search.engine, 'pagefind')
  assert.equal(written.value.search.publicBundle.indexedPageCount, 5)
  assert.equal(written.value.search.protectedBundle?.indexedPageCount, 1)

  assert.equal(existsSync(join(written.value.publicRootRef, 'index.html')), true)
  assert.equal(existsSync(join(written.value.publicRootRef, 'signal.html')), true)
  assert.equal(existsSync(join(written.value.publicRootRef, 'signal', 'post-a.html')), true)
  assert.equal(existsSync(join(written.value.publicRootRef, 'signal', 'post-b.html')), true)
  assert.equal(existsSync(join(written.value.publicRootRef, 'signal', 'post-z.html')), true)
  assert.equal(
    existsSync(join(written.value.protectedRootRef, 'signal', 'protected-note.html')),
    true,
  )
  assert.equal(existsSync(join(written.value.publicRootRef, 'public', 'logo.txt')), true)
  assert.equal(
    existsSync(join(written.value.publicRootRef, 'public', 'covers', 'post-a.jpg')),
    true,
  )
  assert.equal(
    existsSync(join(written.value.publicRootRef, 'public', 'covers', 'post-b.jpg')),
    true,
  )
  assert.equal(
    existsSync(join(written.value.publicRootRef, '_pagefind', 'public', 'pagefind.js')),
    true,
  )
  assert.equal(existsSync(join(written.value.protectedRootRef, 'public', 'logo.txt')), true)
  assert.equal(
    existsSync(join(written.value.protectedRootRef, '_pagefind', 'protected', 'pagefind.js')),
    true,
  )
  assert.equal(existsSync(join(written.value.publicRootRef, 'attachments', 'leak.html')), false)
  assert.equal(existsSync(join(written.value.publicRootRef, 'system', 'ops.html')), false)
  assert.equal(existsSync(join(written.value.publicRootRef, '_meta', 'frontmatter.html')), false)

  assert.match(readFileSync(join(written.value.publicRootRef, 'signal.html'), 'utf8'), /Post A/)
  assert.equal(
    readFileSync(join(written.value.publicRootRef, 'public', 'logo.txt'), 'utf8'),
    'logo asset',
  )
})

test('buildGardenSite renders nested sidebar sections from published folders', async () => {
  const fixture = createVaultFixture()
  const sourceScopeRef = join(fixture.vaultRootRef, 'site')

  onTestFinished(() => {
    rmSync(fixture.dir, { force: true, recursive: true })
  })

  writeTextFile(
    join(sourceScopeRef, '_garden.yml'),
    `schema: garden/v1
title: overment
sections:
  essays:
    title: Essays
    order: 10
  books:
    title: Books
    order: 20
  books/jim-collins:
    title: Jim Collins
    order: 5
public:
  roots:
    - index.md
    - essays
    - books
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: overment
---
Hello.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'books', 'demo.md'),
    `---
title: Demo
order: 20
---
Demo page.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'essays', 'hello.md'),
    `---
title: Hello
order: 10
---
Essay page.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'books', 'jim-collins', 'good-to-great.md'),
    `---
title: Good to Great
order: 5
---
Notes.
`,
  )

  const built = await buildGardenSite({
    sourceScopePath: 'site',
    vaultRootRef: fixture.vaultRootRef,
  })

  assert.equal(built.ok, true)

  if (!built.ok) {
    return
  }

  const publicIndex = built.value.publicPages.find((page) => page.routePath === '/')

  assert.ok(publicIndex)

  if (!publicIndex) {
    return
  }

  assert.match(publicIndex.content, />Books</)
  assert.match(publicIndex.content, />Essays</)
  assert.match(publicIndex.content, />Jim Collins</)
  assert.match(publicIndex.content, />Demo</)
  assert.match(publicIndex.content, />Hello</)
  assert.match(publicIndex.content, />Good to Great</)
  assert.match(
    publicIndex.content,
    /"sectionLabels":\{"books":"Books","books\/jim-collins":"Jim Collins","essays":"Essays"\}/,
  )
  assert.ok(publicIndex.content.indexOf('Good to Great') < publicIndex.content.indexOf('Demo'))
  assert.ok(
    publicIndex.content.indexOf('data-garden-link="internal" href="/essays/hello"') <
      publicIndex.content.indexOf('data-garden-link="internal" href="/books/demo"'),
  )
  assert.match(publicIndex.content, /data-garden-link="internal" href="\/essays\/hello"/)
  assert.match(publicIndex.content, /data-garden-link="internal" href="\/books\/demo"/)
  assert.match(
    publicIndex.content,
    /data-garden-link="internal" href="\/books\/jim-collins\/good-to-great"/,
  )
})

test('compileGardenBuildOutput writes artifacts directly and returns a completed manifest', async () => {
  const fixture = createVaultFixture()
  const sourceScopeRef = join(fixture.vaultRootRef, 'site')
  const outputRootRef = join(fixture.dir, 'compiled')

  onTestFinished(() => {
    rmSync(fixture.dir, { force: true, recursive: true })
  })

  writeTextFile(
    join(sourceScopeRef, '_garden.yml'),
    `schema: garden/v1
title: Streamed Garden
public:
  roots:
    - index.md
    - protected.md
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: Home
---
Hello [[protected]].
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'protected.md'),
    `---
title: Protected
visibility: protected
---
Protected body.
`,
  )

  writeTextFile(join(sourceScopeRef, 'public', 'logo.txt'), 'stream-logo')

  const compiled = await compileGardenBuildOutput({
    outputRootRef,
    sourceScopePath: 'site',
    vaultRootRef: fixture.vaultRootRef,
  })

  assert.equal(compiled.ok, true)

  if (!compiled.ok) {
    return
  }

  const fingerprint = await computeGardenSourceFingerprint({
    sourceScopePath: 'site',
    vaultRootRef: fixture.vaultRootRef,
  })

  assert.equal(fingerprint.ok, true)

  if (!fingerprint.ok) {
    return
  }

  assert.equal(compiled.value.manifest.sourceFingerprintSha256, fingerprint.value)
  assert.equal(compiled.value.manifest.publicPageCount, 1)
  assert.equal(compiled.value.manifest.protectedPageCount, 1)
  assert.equal(compiled.value.manifest.search?.publicBundle.indexedPageCount, 1)
  assert.equal(compiled.value.manifest.search?.protectedBundle?.indexedPageCount, 1)
  assert.equal(existsSync(join(compiled.value.publicRootRef, 'index.html')), true)
  assert.equal(existsSync(join(compiled.value.protectedRootRef, 'protected.html')), true)
  assert.equal(
    existsSync(join(compiled.value.publicRootRef, '_pagefind', 'public', 'pagefind.js')),
    true,
  )
  assert.equal(
    existsSync(join(compiled.value.protectedRootRef, '_pagefind', 'protected', 'pagefind.js')),
    true,
  )
  assert.match(readFileSync(join(compiled.value.publicRootRef, 'index.html'), 'utf8'), /Hello/)
  assert.match(
    readFileSync(join(compiled.value.protectedRootRef, 'protected.html'), 'utf8'),
    /Protected body/,
  )
})

test('buildGardenSite rejects missing cover images outside the published public asset set', async () => {
  const fixture = createVaultFixture()
  const sourceScopeRef = join(fixture.vaultRootRef, 'site')

  onTestFinished(() => {
    rmSync(fixture.dir, { force: true, recursive: true })
  })

  writeTextFile(
    join(sourceScopeRef, '_garden.yml'),
    `schema: garden/v1
public:
  roots:
    - index.md
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: Home
cover_image: public/covers/missing.jpg
---
Hello.
`,
  )

  const built = await buildGardenSite({
    sourceScopePath: 'site',
    vaultRootRef: fixture.vaultRootRef,
  })

  assert.equal(built.ok, false)

  if (built.ok) {
    return
  }

  assert.equal(built.error.type, 'validation')
  assert.match(
    built.error.message,
    /cover_image "public\/covers\/missing\.jpg" was not found under public\//,
  )
})

test('buildGardenSite rejects reserved _meta roots in public.roots', async () => {
  const fixture = createVaultFixture()
  const sourceScopeRef = join(fixture.vaultRootRef, 'site')

  onTestFinished(() => {
    rmSync(fixture.dir, { force: true, recursive: true })
  })

  writeTextFile(
    join(sourceScopeRef, '_garden.yml'),
    `schema: garden/v1
public:
  roots:
    - _meta
`,
  )

  const built = await buildGardenSite({
    sourceScopePath: 'site',
    vaultRootRef: fixture.vaultRootRef,
  })

  assert.equal(built.ok, false)

  if (built.ok) {
    return
  }

  assert.equal(built.error.type, 'validation')
  assert.match(
    built.error.message,
    /public\.roots must not include _meta, attachments, public, or system paths/,
  )
})
