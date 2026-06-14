import { afterEach, describe, expect, test } from 'vitest'

import { createDrizzleSqliteDatabase, openSqliteDatabase } from '../../src/db/sqlite-adapter'
import { createSandboxExecutionPackageRepository } from '../../src/domain/sandbox/sandbox-package-repository'
import {
  asAccountId,
  asSandboxExecutionId,
  asSandboxExecutionPackageId,
  asTenantId,
} from '../../src/shared/ids'
import type { TenantScope } from '../../src/shared/scope'

const createTestDatabase = () => {
  const sqlite = openSqliteDatabase(':memory:')
  sqlite.exec(`
    CREATE TABLE sandbox_execution_packages (
      id text PRIMARY KEY,
      created_at text NOT NULL,
      error_text text,
      install_scripts_allowed integer NOT NULL DEFAULT 0,
      name text NOT NULL,
      registry_host text,
      requested_version text NOT NULL,
      resolved_version text,
      sandbox_execution_id text NOT NULL,
      status text NOT NULL,
      tenant_id text NOT NULL
    );
  `)

  const db = createDrizzleSqliteDatabase(sqlite, { schema: {} }) as Parameters<
    typeof createSandboxExecutionPackageRepository
  >[0]

  return {
    close: () => sqlite.close(),
    db,
  }
}

const scope: TenantScope = {
  accountId: asAccountId('acc_testowner'),
  role: 'owner',
  tenantId: asTenantId('ten_testtenant'),
}

describe('sandbox execution package repository', () => {
  const openHandles: Array<{ close: () => void }> = []

  afterEach(() => {
    while (openHandles.length > 0) {
      openHandles.pop()?.close()
    }
  })

  test('creates, updates, and lists package installation state', () => {
    const handle = createTestDatabase()
    openHandles.push(handle)
    const repository = createSandboxExecutionPackageRepository(handle.db)
    const packageId = asSandboxExecutionPackageId('sbp_package1')
    const executionId = asSandboxExecutionId('sbx_execution1')

    const created = repository.create(scope, {
      createdAt: '2026-04-04T12:00:00.000Z',
      id: packageId,
      installScriptsAllowed: false,
      name: 'left-pad',
      registryHost: 'registry.npmjs.org',
      requestedVersion: '1.3.0',
      sandboxExecutionId: executionId,
      status: 'requested',
    })

    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error(created.error.message)
    }

    const updated = repository.update(scope, {
      errorText: null,
      id: packageId,
      resolvedVersion: '1.3.0',
      status: 'installed',
    })

    expect(updated.ok).toBe(true)
    if (!updated.ok) {
      throw new Error(updated.error.message)
    }

    expect(updated.value.status).toBe('installed')
    expect(updated.value.resolvedVersion).toBe('1.3.0')

    const listed = repository.listBySandboxExecutionId(scope, executionId)

    expect(listed.ok).toBe(true)
    if (!listed.ok) {
      throw new Error(listed.error.message)
    }

    expect(listed.value).toHaveLength(1)
    expect(listed.value[0]).toMatchObject({
      id: packageId,
      name: 'left-pad',
      registryHost: 'registry.npmjs.org',
      requestedVersion: '1.3.0',
      resolvedVersion: '1.3.0',
      status: 'installed',
    })
  })
})
