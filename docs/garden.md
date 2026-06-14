# Garden Files

Garden is file-first.

Each site reads from a selected source scope inside the creating account's `vault/`.
Inside that scope:

- `_garden.yml` defines site-wide structure and publishing rules.
- `*.md` files define pages.
- `public/**` contains publishable assets.
- `_meta/`, `attachments/`, and `system/` stay private and are never published.

## Current Status

Implemented now:

- file-first Garden sources in an account-owned `vault/` scope
- `_garden.yml` parsing and source bootstrap
- manual and auto-scan build modes
- public and protected page builds
- API-hosted preview and live serving
- page metadata for `description`, `excerpt`, `tags`, `cover_image`, `order`, and current SEO fields
- section ordering in `_garden.yml`
- nested sidebar generation from published folder structure
- built-in Garden search powered by Pagefind with public and protected bundles
- auto scan rebuilds and publishes active sites automatically after publish-relevant changes

Current limits:

- GitHub Pages deployment is still not implemented
- `seo_image` is not rendered yet
- tags do not generate archive pages yet
- `unlisted` visibility is still deferred
- search UI is generated automatically today; it is not configurable from `_garden.yml` yet
Deeper implementation status and phase notes live in [apps/server/spec/garden.md](../apps/server/spec/garden.md).

## Build Modes

Build mode is a Garden site setting, not a field in `_garden.yml`.

- `manual`: create a new build only when requested explicitly
- `auto scan`: for active sites, the server polls the selected source scope, creates a new build after publish-relevant changes settle for a short debounce window, and publishes the latest successful build

### Auto Scan Notes

- auto scan currently tracks `_garden.yml`, Markdown files that resolve to published pages, and files under `public/**`
- changes under `_meta/`, `attachments/`, and `system/` do not trigger builds because they are never published
- auto scan creates a fresh build artifact set and advances the live site to the latest successful build

## Example Source Scope

```text
vault/
  overment/
    _garden.yml
    _meta/
      frontmatter.md
    index.md
    essays/
      hello.md
    books/
      demo.md
      jim-collins/
        good-to-great.md
    public/
      covers/
        good-to-great.jpg
      logo.svg
```

## `_garden.yml`

`_garden.yml` is required at the root of the selected source scope.

```yaml
schema: garden/v1
title: overment.ai
description: Notes, essays, projects, and reading traces.

public:
  roots:
    - index.md
    - essays
    - books
  exclude:
    - books/drafts

listing:
  default_page_size: 20

sections:
  essays:
    title: Essays
    description: Longer writing and working notes.
    order: 10
  books:
    title: Books
    description: Reading notes and summaries.
    order: 20
  books/jim-collins:
    title: Jim Collins
    order: 5

navigation:
  - label: Home
    path: /
```

### Supported Fields

- `schema`: must be `garden/v1`
- `title`: site title used in layout
- `description`: site-level description
- `public.roots`: files or folders that are allowed to publish
- `public.exclude`: files or folders to exclude from those roots
- `listing.default_page_size`: default page size for listing pages
- `sections.<path>.title`: sidebar section label override
- `sections.<path>.description`: sidebar section description
- `sections.<path>.order`: sidebar section sort order, ascending
- `navigation`: optional explicit nav entries, currently used only for home labeling
- `theme`: reserved for future theme selection

### Path Rules

- Paths are always relative to the selected source scope.
- Do not use absolute paths.
- Do not use `..`.
- `public.roots` cannot include `_meta/`, `attachments/`, `public/`, or `system/`.
- `sections` keys use slug-like relative paths such as `books/jim-collins`.

## Page Files

Each Markdown file becomes a candidate page.
The route comes from the file path:

- `index.md` -> `/`
- `books/demo.md` -> `/books/demo`
- `books/jim-collins/good-to-great.md` -> `/books/jim-collins/good-to-great`

The same path structure also drives the generated sidebar, so nested folders become nested menu sections.

## Page Frontmatter

```md
---
title: Good to Great
description: Why disciplined people, thought, and action matter.
excerpt: Notes and takeaways from the book with the main frameworks pulled out.
tags: [books, strategy, leadership]
cover_image: public/covers/good-to-great.jpg
order: 20

date: 2026-04-03
updated: 2026-04-04
listing: false
listing_page_size: 12
visibility: public
draft: false
publish: true

seo_title: Good to Great Notes
seo_description: Summary and notes from Good to Great.
seo_canonical: https://example.com/books/good-to-great
seo_keywords: [books, strategy, leadership]
seo_noindex: false
---
```

### Supported Page Fields

If you want a local schema reference while editing or prompting an agent, read `_meta/frontmatter.md` inside the Garden source root. It is generated as a private helper file and is never published.

- `title`: page title
- `description`: shown under the page title and used as the default meta description
- `excerpt`: used in generated listings; falls back to `description` when omitted
- `tags`: array or comma-separated string
- `cover_image`: path to a file under `public/**`
- `order`: ascending sibling order in sidebar and generated listings
- `date`: planted date
- `updated`: tended date
- `draft: true`: excludes the page from output
- `publish: false`: excludes the page from output
- `listing: true`: turns the page into a generated listing of child pages
- `listing_page_size`: overrides site default listing size
- `template`: reserved for future template variants
- `visibility: public | protected | private`
- `seo_title`
- `seo_description`
- `seo_canonical`
- `seo_keywords`
- `seo_noindex`
- `seo_image`: reserved in page metadata today, but not yet surfaced by the renderer

### Frontmatter Rules

- `cover_image` must resolve to an existing file under `public/**`.
- `tags` are trimmed and deduplicated only by exact string value today.
- `order` is optional. Explicit order values sort before unordered siblings.
- When `order` is absent, listing fallback order is date descending, then title.
- `visibility: protected` publishes only into the protected artifact set.
- The Garden Admin site password only unlocks pages with `visibility: protected`; it does not password-protect public pages or the whole site.
- Protected pages are hidden from the public sidebar. Reach them through a direct protected URL or an explicit link, then unlock the site when prompted.
- `visibility: private` emits no route at all.

## Render Behavior

- `description` is rendered below the page title.
- `tags` are rendered as simple chips near the page header.
- `cover_image` is rendered above the page title.
- generated listings use `excerpt`, or `description` when `excerpt` is missing
- sidebar nesting is generated from published folder and page slugs
- sidebar ordering uses page `order` and section `order` when present
- `sections` overrides generated sidebar labels, descriptions, and ordering for matching paths
- `navigation` does not define the full sidebar tree today
- search indexes are generated automatically from published HTML at build time
- search filter chips are derived from the current result set, limited to a small set, and show query-scoped counts

## Asset Rules

- Only files under `public/**` are copied into published artifacts.
- Markdown links to `public/...` or `/public/...` are rewritten as internal Garden asset links.
- When writing markdown, reference publishable images and files with their source asset path under `public/**`, for example `![Diagram](/public/files/diagram.png)`.
- Do not guess the final served URL namespace such as `/files/diagram.png`; authored markdown should still point at `/public/...`.
- `cover_image` uses the same published asset pipeline.
- `_meta/` is reserved for private Garden helper files such as `_meta/frontmatter.md`.
- `attachments/` is never reused as a public or protected asset bucket.

## Practical Guidance

- Use `_garden.yml` for site-wide structure.
- Use page frontmatter for page-local metadata.
- Keep secrets, passwords, and deploy settings out of files.
- Put images intended for publishing in `public/**`.
- Put private uploads and raw material in `attachments/`.
