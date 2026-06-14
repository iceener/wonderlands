import { access, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { GardenSiteRecord } from '../../domain/garden/garden-site-repository'
import { ensureGardenSourceMetaFiles } from './meta-files'

export interface GardenSourceBootstrapResult {
  createdPaths: string[]
  skippedPaths: string[]
  sourceScopePath: string
}

const pathExists = async (ref: string): Promise<boolean> =>
  access(ref).then(
    () => true,
    () => false,
  )

const toYamlString = (value: string): string => JSON.stringify(value)

const toGardenConfigSource = (site: GardenSiteRecord): string => `schema: garden/v1
title: ${toYamlString(site.name)}
navigation:
  - label: Home
    path: /
public:
  roots:
    - index.md
`

const toIndexMarkdownSource = (site: GardenSiteRecord): string => `---
title: ${toYamlString(site.name)}
---

Welcome to ${site.name}.

Edit this page, add more markdown files, and update \`_garden.yml\` to shape the published Garden.
`

export const bootstrapGardenSource = async (input: {
  site: GardenSiteRecord
  sourceScopeRef: string
  sourceScopePath: string
}): Promise<GardenSourceBootstrapResult> => {
  await mkdir(input.sourceScopeRef, { recursive: true })

  const createdPaths: string[] = []
  const skippedPaths: string[] = []
  const configRef = resolve(input.sourceScopeRef, '_garden.yml')
  const indexRef = resolve(input.sourceScopeRef, 'index.md')
  const publicRef = resolve(input.sourceScopeRef, 'public')

  if (await pathExists(configRef)) {
    skippedPaths.push('_garden.yml')
  } else {
    await writeFile(configRef, toGardenConfigSource(input.site), 'utf8')
    createdPaths.push('_garden.yml')
  }

  if (await pathExists(indexRef)) {
    skippedPaths.push('index.md')
  } else {
    await writeFile(indexRef, toIndexMarkdownSource(input.site), 'utf8')
    createdPaths.push('index.md')
  }

  if (await pathExists(publicRef)) {
    skippedPaths.push('public/')
  } else {
    await mkdir(publicRef, { recursive: true })
    createdPaths.push('public/')
  }

  const metaFiles = await ensureGardenSourceMetaFiles(input.sourceScopeRef)
  createdPaths.push(...metaFiles.createdPaths)
  skippedPaths.push(...metaFiles.skippedPaths)

  return {
    createdPaths,
    skippedPaths,
    sourceScopePath: input.sourceScopePath,
  }
}
