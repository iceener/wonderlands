import { loadConfig } from '../src/app/config'
import { loadEnvFileIntoProcess } from '../src/app/load-env'
import { createGardenService } from '../src/application/garden/garden-service'
import { createGardenSiteRepository } from '../src/adapters/persistence/sqlite'
import { createDatabaseClient } from '../src/db/client'
import { createPrefixedId } from '../src/shared/ids'

loadEnvFileIntoProcess()

const config = loadConfig()
const db = createDatabaseClient(config)
const gardenService = createGardenService({
  apiBasePath: config.api.basePath,
  createId: createPrefixedId,
  db,
  fileStorageRoot: config.files.storage.root,
  now: () => new Date().toISOString(),
})

let failed = 0
let published = 0

try {
  const activeSites = createGardenSiteRepository(db).listActive()

  if (!activeSites.ok) {
    throw new Error(activeSites.error.message)
  }

  console.info(`Rebuilding ${activeSites.value.length} active Garden site(s)...`)

  for (const site of activeSites.value) {
    const build = await gardenService.requestAutoBuild(site.id)

    if (!build.ok) {
      failed += 1
      console.error(`[${site.slug}] build request failed: ${build.error.message}`)
      continue
    }

    if (build.value.status !== 'completed') {
      failed += 1
      console.error(
        `[${site.slug}] build ${build.value.id} ended with status ${build.value.status}: ${build.value.errorMessage ?? 'unknown build error'}`,
      )
      continue
    }

    const publish = gardenService.publishCurrentBuild(site.id, build.value.requestedByAccountId)

    if (!publish.ok) {
      failed += 1
      console.error(`[${site.slug}] publish failed: ${publish.error.message}`)
      continue
    }

    published += 1
    console.info(`[${site.slug}] published build ${build.value.id}`)
  }
} finally {
  db.close()
}

console.info(`Garden rebuild complete: ${published} published, ${failed} failed.`)

if (failed > 0) {
  process.exitCode = 1
}
