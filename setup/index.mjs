import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { createSpinner, printBanner, printKeyValueTable, printSection, prompt, promptChoice, promptConfirm, promptPassword, ui } from './lib/ui.mjs'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const serverDir = resolve(rootDir, 'apps/server')
const serverEnvPath = resolve(serverDir, '.env')
const serverEnvExamplePath = resolve(serverDir, '.env.example')
const serverMcpPath = resolve(serverDir, '.mcp-servers.json')
const serverMcpExamplePath = resolve(serverDir, '.mcp-servers.example.json')
const credentialsPath = resolve(rootDir, '.credentials.json')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const ENV_LINE_PATTERN = /^(\s*)(?:export\s+)?([\w.-]+)(\s*=\s*)(.*)\s*$/
const localDatabasePath = './var/05_04_api.sqlite'
const localFileStorageRoot = './var/files'

const seedDefaults = {
  accountEmail: 'main@local.test',
  accountName: 'Main Account',
  apiKeyLabel: 'Main local key',
  tenantName: 'Local Workspace',
  tenantRole: 'owner',
  tenantSlug: 'local-workspace',
}

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-')

const normalizeEnvValue = (rawValue) => {
  const trimmed = rawValue.trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

const parseEnvAssignments = (source) => {
  const assignments = {}

  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const match = ENV_LINE_PATTERN.exec(line)

    if (!match) {
      continue
    }

    assignments[match[2]] = normalizeEnvValue(match[4])
  }

  return assignments
}

const serializeEnvValue = (value) => {
  if (!value) {
    return ''
  }

  return /[\s#"'`]/u.test(value) ? JSON.stringify(value) : value
}

const applyEnvUpdates = (source, updates) => {
  const lines = source.split(/\r?\n/u)
  const seenKeys = new Set()

  const nextLines = lines.map((line) => {
    const match = ENV_LINE_PATTERN.exec(line)

    if (!match) {
      return line
    }

    const key = match[2]

    if (!(key in updates)) {
      return line
    }

    seenKeys.add(key)
    return `${match[1]}${key}${match[3]}${serializeEnvValue(updates[key])}`
  })

  for (const [key, value] of Object.entries(updates)) {
    if (!seenKeys.has(key)) {
      nextLines.push(`${key}=${serializeEnvValue(value)}`)
    }
  }

  return `${nextLines.join('\n').replace(/\n*$/u, '')}\n`
}

const readEnvFile = (filePath) => (existsSync(filePath) ? readFileSync(filePath, 'utf8') : '')

const promptSecretValue = async (label, existingValue) => {
  const value = (await promptPassword(
    `${label} ${ui.dim(existingValue ? '(leave blank to keep existing)' : '(leave blank to skip)')}`,
  )).trim()

  return value || existingValue || ''
}

const runCommand = ({
  args,
  captureOutput = false,
  cwd = rootDir,
  env,
  label,
}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(npmCommand, args, {
      shell: false,
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })

    let stdout = ''
    let stderr = ''

    if (captureOutput) {
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
    }

    child.on('error', (error) => {
      rejectPromise(error)
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise({ stderr, stdout })
        return
      }

      const error = new Error(`${label} failed with exit code ${code ?? 'unknown'}`)
      error.stdout = stdout
      error.stderr = stderr
      rejectPromise(error)
    })
  })

const ensureFileFromExample = (targetPath, examplePath) => {
  if (existsSync(targetPath) || !existsSync(examplePath)) {
    return false
  }

  copyFileSync(examplePath, targetPath)
  return true
}

const ensureLocalDataDirectories = () => {
  mkdirSync(resolve(serverDir, 'var', 'files'), { recursive: true })
}

const collectSeedAnswers = async () => {
  printSection('Seed profile', 'Press Enter to accept the default value shown in brackets.')

  const accountEmail = await prompt('Account email', {
    defaultValue: seedDefaults.accountEmail,
  })
  const accountName = await prompt('Account name', {
    defaultValue: seedDefaults.accountName,
  })
  const accountPassword = await promptPassword(
    'Account password (leave blank to generate or reuse stored secret)',
  )
  const tenantName = await prompt('Tenant name', {
    defaultValue: seedDefaults.tenantName,
  })
  const suggestedTenantSlug = slugify(tenantName) || seedDefaults.tenantSlug
  const tenantSlug = await prompt('Tenant slug', {
    defaultValue: suggestedTenantSlug,
  })
  const tenantRole = await promptChoice(
    'Tenant role',
    ['owner', 'admin', 'member', 'viewer', 'service'],
    seedDefaults.tenantRole,
  )
  const apiKeyLabel = await prompt('API key label', {
    defaultValue: seedDefaults.apiKeyLabel,
  })

  return {
    accountEmail,
    accountName,
    accountPassword,
    apiKeyLabel,
    tenantName,
    tenantRole,
    tenantSlug,
  }
}

const collectProviderAnswers = async (envAssignments) => {
  printSection('Provider config', 'You can leave secrets blank to keep the current value or skip them.')

  const openAiApiKey = await promptSecretValue('OpenAI API key', envAssignments.OPENAI_API_KEY)
  const googleApiKey = await promptSecretValue(
    'Gemini API key (stored as GOOGLE_API_KEY)',
    envAssignments.GOOGLE_API_KEY,
  )
  const openRouterApiKey = await promptSecretValue(
    'OpenRouter API key',
    envAssignments.OPENROUTER_API_KEY,
  )
  const langfuseConfigured = Boolean(
    (envAssignments.LANGFUSE_SECRET_KEY && envAssignments.LANGFUSE_PUBLIC_KEY) ||
      envAssignments.LANGFUSE_ENABLED === 'true',
  )
  const configureLangfuse = await promptConfirm(
    langfuseConfigured ? 'Review Langfuse settings?' : 'Configure Langfuse tracing now?',
    langfuseConfigured,
  )

  const updates = {
    GOOGLE_API_KEY: googleApiKey,
    OPENAI_API_KEY: openAiApiKey,
    OPENROUTER_API_KEY: openRouterApiKey,
  }

  if (configureLangfuse) {
    const langfuseSecretKey = await promptSecretValue(
      'Langfuse secret key',
      envAssignments.LANGFUSE_SECRET_KEY,
    )
    const langfusePublicKey = await promptSecretValue(
      'Langfuse public key',
      envAssignments.LANGFUSE_PUBLIC_KEY,
    )
    const langfuseBaseUrl = await prompt('Langfuse base URL', {
      defaultValue: envAssignments.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    })
    const langfuseEnvironment = await prompt('Langfuse environment', {
      defaultValue: envAssignments.LANGFUSE_ENVIRONMENT || 'development',
    })
    const langfuseEnabled = await promptConfirm(
      'Enable Langfuse tracing?',
      envAssignments.LANGFUSE_ENABLED
        ? envAssignments.LANGFUSE_ENABLED === 'true'
        : Boolean(langfuseSecretKey && langfusePublicKey),
    )

    return {
      ...updates,
      LANGFUSE_BASE_URL: langfuseBaseUrl,
      LANGFUSE_ENABLED: langfuseEnabled ? 'true' : 'false',
      LANGFUSE_ENVIRONMENT: langfuseEnvironment,
      LANGFUSE_PUBLIC_KEY: langfusePublicKey,
      LANGFUSE_SECRET_KEY: langfuseSecretKey,
    }
  }

  return updates
}

const parseSeedResult = (rawOutput) => {
  const lines = rawOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const lastLine = lines.at(-1)

  if (!lastLine) {
    throw new Error('Seed command did not return any output.')
  }

  return JSON.parse(lastLine)
}

const printCredentialSummary = (seedResult) => {
  printSection('Credentials', 'These values come from the local seed manifest and can be reused later.')
  printKeyValueTable([
    ['Browser email', seedResult.accountEmail],
    ['Browser password', seedResult.accountPassword],
    ['Account id', seedResult.accountId],
    ['Tenant id', seedResult.tenantId],
    ['Tenant role', seedResult.tenantRole],
    ['API key id', seedResult.apiKeyId],
    ['API key secret', seedResult.apiKeySecret],
    ['Secret source', seedResult.secretSource],
    ['Manifest', seedResult.manifestPath],
  ])

  process.stdout.write('\n')
  printKeyValueTable([
    ['Authorization', `Bearer ${seedResult.apiKeySecret}`],
    ['X-Tenant-Id', seedResult.tenantId],
  ])
}

const storeCredentials = (seedResult) => {
  const nowIso = new Date().toISOString()
  const nextDocument = existsSync(credentialsPath)
    ? JSON.parse(readFileSync(credentialsPath, 'utf8'))
    : {}

  nextDocument.wonderlands = {
    updatedAt: nowIso,
    login: {
      email: seedResult.accountEmail,
      password: seedResult.accountPassword,
    },
    account: {
      id: seedResult.accountId,
    },
    tenant: {
      id: seedResult.tenantId,
      role: seedResult.tenantRole,
    },
    apiKey: {
      authorizationHeader: `Bearer ${seedResult.apiKeySecret}`,
      id: seedResult.apiKeyId,
      secret: seedResult.apiKeySecret,
    },
    manifestPath: seedResult.manifestPath,
    server: {
      apiBaseUrl: 'http://127.0.0.1:3000/v1',
      uiBaseUrl: 'http://127.0.0.1:5173',
    },
  }

  writeFileSync(credentialsPath, `${JSON.stringify(nextDocument, null, 2)}\n`, 'utf8')
}

const main = async () => {
  printBanner()

  if (!(await promptConfirm('Proceed with local setup?', true))) {
    process.stdout.write(`${ui.yellow('Setup cancelled.')}\n`)
    return
  }

  const seedAnswers = await collectSeedAnswers()

  printSection('Preparing files')
  const envCreated = ensureFileFromExample(serverEnvPath, serverEnvExamplePath)
  const mcpCreated = ensureFileFromExample(serverMcpPath, serverMcpExamplePath)

  printKeyValueTable([
    ['apps/server/.env', envCreated ? 'created from .env.example' : 'using existing file'],
    ['apps/server/.mcp-servers.json', mcpCreated ? 'created from example' : 'using existing or skipping'],
  ])

  const currentEnvSource = readEnvFile(serverEnvPath)
  const envAssignments = parseEnvAssignments(currentEnvSource)
  const providerUpdates = await collectProviderAnswers(envAssignments)

  const mcpKey = envAssignments.MCP_SECRET_ENCRYPTION_KEY || randomBytes(32).toString('hex')
  const infraUpdates = {
    DATABASE_PATH: envAssignments.DATABASE_PATH || localDatabasePath,
    FILE_STORAGE_ROOT: envAssignments.FILE_STORAGE_ROOT || localFileStorageRoot,
    MCP_SECRET_ENCRYPTION_KEY: mcpKey,
    KERNEL_ENABLED: envAssignments.KERNEL_ENABLED || 'true',
    KERNEL_PROVIDER: envAssignments.KERNEL_PROVIDER || 'local',
    KERNEL_CDP_URL: envAssignments.KERNEL_CDP_URL || 'http://127.0.0.1:9222',
    KERNEL_LOCAL_API_URL: envAssignments.KERNEL_LOCAL_API_URL || 'http://127.0.0.1:10001',
  }

  const nextEnvSource = applyEnvUpdates(currentEnvSource, { ...providerUpdates, ...infraUpdates })
  const resolvedEnvAssignments = parseEnvAssignments(nextEnvSource)

  if (nextEnvSource !== currentEnvSource) {
    writeFileSync(serverEnvPath, nextEnvSource, 'utf8')
  }

  if (
    resolvedEnvAssignments.DATABASE_PATH === localDatabasePath ||
    resolvedEnvAssignments.FILE_STORAGE_ROOT === localFileStorageRoot
  ) {
    ensureLocalDataDirectories()
  }

  printSection('Configuration summary')
  printKeyValueTable([
    ['OpenAI API key', resolvedEnvAssignments.OPENAI_API_KEY ? 'configured' : 'not set'],
    ['Gemini API key', resolvedEnvAssignments.GOOGLE_API_KEY ? 'configured' : 'not set'],
    ['OpenRouter API key', resolvedEnvAssignments.OPENROUTER_API_KEY ? 'configured' : 'not set'],
    ['Langfuse', resolvedEnvAssignments.LANGFUSE_ENABLED === 'true' ? 'enabled' : 'not configured'],
    ['MCP encryption key', 'auto-generated'],
    ['Kernel browser', `${resolvedEnvAssignments.KERNEL_ENABLED === 'true' ? 'enabled' : 'disabled'} (${resolvedEnvAssignments.KERNEL_PROVIDER})`],
    ['Database path', resolvedEnvAssignments.DATABASE_PATH || localDatabasePath],
    ['File storage root', resolvedEnvAssignments.FILE_STORAGE_ROOT || localFileStorageRoot],
  ])

  process.stdout.write(
    `\n${ui.dim('Local setup keeps mutable server data under apps/server/var. For production, set DATABASE_PATH and FILE_STORAGE_ROOT to absolute paths outside the repo checkout.')}\n`,
  )

  printSection('Installing dependencies', 'This runs npm install from the workspace root.')
  await runCommand({
    args: ['install'],
    captureOutput: false,
    label: 'npm install',
  })

  const migrateSpinner = createSpinner('Applying database migrations')
  migrateSpinner.start()

  try {
    await runCommand({
      args: ['run', 'db:migrate', '--workspace', '@wonderlands/server'],
      captureOutput: true,
      label: 'database migrations',
    })
    migrateSpinner.succeed('Database migrations applied')
  } catch (error) {
    migrateSpinner.fail('Database migrations failed')
    throw error
  }

  const seedSpinner = createSpinner('Seeding the local account')
  seedSpinner.start()

  let seedResult

  try {
    const { stdout } = await runCommand({
      args: ['run', 'db:seed', '--workspace', '@wonderlands/server'],
      captureOutput: true,
      env: {
        NODE_ENV: 'test',
        SEED_ACCOUNT_EMAIL: seedAnswers.accountEmail,
        SEED_ACCOUNT_NAME: seedAnswers.accountName,
        SEED_ACCOUNT_PASSWORD: seedAnswers.accountPassword,
        SEED_API_KEY_LABEL: seedAnswers.apiKeyLabel,
        SEED_GARDEN: '1',
        SEED_OUTPUT_JSON: '1',
        SEED_TENANT_NAME: seedAnswers.tenantName,
        SEED_TENANT_ROLE: seedAnswers.tenantRole,
        SEED_TENANT_SLUG: seedAnswers.tenantSlug,
      },
      label: 'database seed',
    })
    seedResult = parseSeedResult(stdout)
    seedSpinner.succeed('Local account seeded')
  } catch (error) {
    seedSpinner.fail('Database seed failed')
    throw error
  }

  printCredentialSummary(seedResult)

  if (await promptConfirm(`Store these credentials in ${credentialsPath}?`, true)) {
    storeCredentials(seedResult)
    process.stdout.write(`\n${ui.green(`Stored credentials in ${credentialsPath}`)}\n`)
  } else {
    process.stdout.write(`\n${ui.dim('Skipped writing .credentials.json')}\n`)
  }

  printSection('Next steps')
  printKeyValueTable([
    ['Start both apps', 'npm run dev'],
    ['Start server only', 'npm run dev:server'],
    ['Start client only', 'npm run dev:client'],
    ['Start Kernel browser', 'npm run kernel:up'],
  ])

  process.stdout.write(`\n${ui.dim('Kernel browser sandbox requires Docker. Run npm run kernel:up before starting the server.')}\n`)
  process.stdout.write(`${ui.dim('Optional lo sandbox runtime setup is documented in the README.')}\n`)
}

await main().catch((error) => {
  process.stderr.write(`\n${ui.red(ui.bold('Setup failed'))}\n`)
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  if (error?.stderr) {
    process.stderr.write(`\n${error.stderr}\n`)
  }
  process.exitCode = 1
})
