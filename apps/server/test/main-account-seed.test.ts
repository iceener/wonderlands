import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { accounts, apiKeys, tenantMemberships, tenants } from '../src/db/schema'
import { seedMainAccount } from '../src/db/seeds/seed-main-account'
import { hashApiKeySecret } from '../src/shared/api-key'
import { createTestHarness } from './helpers/create-test-app'

test('seedMainAccount creates the main account, tenant, membership, and api key', () => {
  const { runtime } = createTestHarness()

  try {
    const seedResult = seedMainAccount(runtime)
    const [accountRecord] = runtime.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, seedResult.accountId))
      .all()
    const [tenantRecord] = runtime.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, seedResult.tenantId))
      .all()
    const [membershipResult] = runtime.db
      .select()
      .from(tenantMemberships)
      .where(eq(tenantMemberships.accountId, seedResult.accountId))
      .all()
    const [apiKeyRecord] = runtime.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, seedResult.apiKeyId))
      .all()
    const manifestRecord = JSON.parse(readFileSync(seedResult.manifestPath, 'utf8'))

    assert.equal(accountRecord?.email, 'main@local.test')
    assert.equal(accountRecord?.name, 'Main Account')
    assert.match(seedResult.accountId, /^acc_[a-f0-9]{32}$/)
    assert.match(seedResult.tenantId, /^ten_[a-f0-9]{32}$/)
    assert.match(seedResult.apiKeyId, /^key_[a-f0-9]{32}$/)
    assert.equal(tenantRecord?.slug, 'local-workspace')
    assert.equal(membershipResult?.role, 'owner')
    assert.equal(apiKeyRecord?.hashedSecret, hashApiKeySecret(seedResult.apiKeySecret))
    assert.equal(apiKeyRecord?.status, 'active')
    assert.equal(manifestRecord.accountId, seedResult.accountId)
    assert.equal(manifestRecord.tenantId, seedResult.tenantId)
    assert.equal(manifestRecord.apiKeyId, seedResult.apiKeyId)
    assert.equal(manifestRecord.apiKeySecret, seedResult.apiKeySecret)
    assert.equal(manifestRecord.version, 3)
  } finally {
    runtime.db.close()
  }
})

test('seedMainAccount is idempotent and reuses the persisted secret', () => {
  const { runtime } = createTestHarness()

  try {
    const firstSeedResult = seedMainAccount(runtime)
    const secondSeedResult = seedMainAccount(runtime)

    assert.equal(firstSeedResult.apiKeySecret, secondSeedResult.apiKeySecret)
    assert.equal(firstSeedResult.accountId, secondSeedResult.accountId)
    assert.equal(firstSeedResult.tenantId, secondSeedResult.tenantId)
    assert.equal(firstSeedResult.apiKeyId, secondSeedResult.apiKeyId)
    assert.equal(firstSeedResult.manifestPath, secondSeedResult.manifestPath)
    assert.equal(secondSeedResult.secretSource, 'existing')
    assert.equal(runtime.db.select().from(accounts).all().length, 1)
    assert.equal(runtime.db.select().from(tenants).all().length, 1)
    assert.equal(runtime.db.select().from(tenantMemberships).all().length, 1)
    assert.equal(runtime.db.select().from(apiKeys).all().length, 1)
  } finally {
    runtime.db.close()
  }
})
