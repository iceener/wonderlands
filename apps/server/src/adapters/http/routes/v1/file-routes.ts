import { Hono } from 'hono'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { createFileRepository } from '../../../../domain/files/file-repository'
import { DomainErrorException } from '../../../../shared/errors'
import { asFileId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { toFileSummary } from '../../presenters/file-presenter'
import { requireFileAccess } from '../../route-resource-access'
import { unwrapRouteResult } from '../../route-support'

const toDispositionAscii = (value: string): string =>
  value
    .replace(/[\r\n"]/g, '_')
    .replace(/[\\/]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')

const toContentDisposition = (value: string | null): string => {
  const name = value ?? 'file'
  const ascii = toDispositionAscii(name)
  const needsUtf8 = ascii !== name.replace(/[\r\n"]/g, '_').replace(/[\\/]/g, '_')
  if (!needsUtf8) {
    return `inline; filename="${ascii}"`
  }
  // RFC 5987: filename* with UTF-8 encoding for non-ASCII names
  const encoded = encodeURIComponent(name).replace(/'/g, '%27')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

export const createFileRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/', async (c) => {
    const tenantScope = requireTenantScope(c)
    const requestedScope = c.req.query('scope')

    if (requestedScope !== 'account_library') {
      throw new DomainErrorException({
        message: 'Only scope=account_library is currently supported on this endpoint',
        type: 'validation',
      })
    }

    const result = unwrapRouteResult(
      createFileRepository(c.get('db')).listAccountLibraryByAccountId(tenantScope),
    )

    return c.json(
      successEnvelope(
        c,
        result.map((file) => toFileSummary(c.get('config').api.basePath, file)),
      ),
      200,
    )
  })

  routes.get('/:fileId', async (c) => {
    const { file } = requireFileAccess(c, asFileId(c.req.param('fileId')))

    return c.json(successEnvelope(c, toFileSummary(c.get('config').api.basePath, file)), 200)
  })

  routes.get('/:fileId/content', async (c) => {
    const { file } = requireFileAccess(c, asFileId(c.req.param('fileId')))

    if (file.status !== 'ready') {
      throw new DomainErrorException({
        message: `file ${file.id} is not ready`,
        type: 'conflict',
      })
    }

    const blobResult = await c.get('services').files.blobStore.get(file.storageKey)

    if (!blobResult.ok) {
      throw new DomainErrorException(blobResult.error)
    }

    c.header('content-type', file.mimeType ?? 'application/octet-stream')
    c.header('content-disposition', toContentDisposition(file.originalFilename))

    return c.body(blobResult.value.body.buffer as ArrayBuffer, 200)
  })

  return routes
}
