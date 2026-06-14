import { loadConfig } from '../app/config'
import { loadEnvFileIntoProcess } from '../app/load-env'
import { closeAppRuntime, createAppRuntime } from '../app/runtime'
import { type TenantRole, tenantRoleValues } from '../shared/scope'
import { type SeedMainAccountInput, seedMainAccount } from './seeds/seed-main-account'

loadEnvFileIntoProcess()

const formatSeedInstructions = (seedResult: ReturnType<typeof seedMainAccount>): string =>
  [
    'Seeded main account.',
    `email: ${seedResult.accountEmail}`,
    `account id: ${seedResult.accountId}`,
    `tenant id: ${seedResult.tenantId}`,
    `tenant role: ${seedResult.tenantRole}`,
    `api key id: ${seedResult.apiKeyId}`,
    `secret source: ${seedResult.secretSource}`,
    `credentials manifest: ${seedResult.manifestPath}`,
    'Secrets are stored in the manifest and are not printed to stdout.',
  ].join('\n')

const formatSeedSecrets = (seedResult: ReturnType<typeof seedMainAccount>): string =>
  [
    'Seeded main account.',
    '',
    'Browser login',
    `email: ${seedResult.accountEmail}`,
    `password: ${seedResult.accountPassword}`,
    '',
    'API access',
    `authorization: Bearer ${seedResult.apiKeySecret}`,
    `x-tenant-id: ${seedResult.tenantId}`,
    '',
    'Identifiers',
    `account id: ${seedResult.accountId}`,
    `tenant id: ${seedResult.tenantId}`,
    `tenant role: ${seedResult.tenantRole}`,
    `api key id: ${seedResult.apiKeyId}`,
    `secret source: ${seedResult.secretSource}`,
    `credentials manifest: ${seedResult.manifestPath}`,
  ].join('\n')

const parseOptionalString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const parseTenantRole = (value: string | undefined): TenantRole | undefined => {
  const trimmed = parseOptionalString(value)

  if (!trimmed) {
    return undefined
  }

  return tenantRoleValues.includes(trimmed as TenantRole) ? (trimmed as TenantRole) : undefined
}

const parseSeedInputFromEnv = (env: NodeJS.ProcessEnv): SeedMainAccountInput => ({
  accountEmail: parseOptionalString(env.SEED_ACCOUNT_EMAIL),
  accountName: parseOptionalString(env.SEED_ACCOUNT_NAME),
  accountPassword: parseOptionalString(env.SEED_ACCOUNT_PASSWORD),
  apiKeyLabel: parseOptionalString(env.SEED_API_KEY_LABEL),
  apiKeySecret: parseOptionalString(env.SEED_API_KEY_SECRET),
  seedGarden: parseBoolean(env.SEED_GARDEN),
  tenantName: parseOptionalString(env.SEED_TENANT_NAME),
  tenantRole: parseTenantRole(env.SEED_TENANT_ROLE),
  tenantSlug: parseOptionalString(env.SEED_TENANT_SLUG),
})

const parseBoolean = (value: string | undefined): boolean => value === '1' || value === 'true'

const main = async () => {
  const config = loadConfig()
  const runtime = createAppRuntime(config)

  try {
    const seedResult = seedMainAccount(runtime, parseSeedInputFromEnv(process.env))

    if (parseBoolean(process.env.SEED_OUTPUT_JSON)) {
      console.info(JSON.stringify(seedResult))
      return
    }

    console.info(
      parseBoolean(process.env.SEED_PRINT_SECRETS)
        ? formatSeedSecrets(seedResult)
        : formatSeedInstructions(seedResult),
    )
  } finally {
    await closeAppRuntime(runtime)
  }
}

await main()
