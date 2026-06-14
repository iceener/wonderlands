import { Hono } from 'hono'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { createUploadFileCommand } from '../../../../application/files/upload-file'
import { DomainErrorException } from '../../../../shared/errors'
import { asWorkSessionId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { toUploadedFileResponse } from '../../presenters/file-presenter'

const isUploadedFileLike = (value: FormDataEntryValue | null): value is File =>
  value instanceof File

export const createUploadRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()
  const uploadFileCommand = createUploadFileCommand()

  routes.post('/', async (c) => {
    const tenantScope = requireTenantScope(c)
    const formData = await c.req.formData()
    const fileEntry = formData.get('file')
    const accessScope = formData.get('accessScope')
    const sessionId = formData.get('sessionId')
    const title = formData.get('title')

    if (!isUploadedFileLike(fileEntry)) {
      throw new DomainErrorException({
        message: 'Multipart field "file" is required',
        type: 'validation',
      })
    }

    if (accessScope !== 'session_local' && accessScope !== 'account_library') {
      throw new DomainErrorException({
        message: 'Multipart field "accessScope" must be "session_local" or "account_library"',
        type: 'validation',
      })
    }

    if (sessionId !== null && typeof sessionId !== 'string') {
      throw new DomainErrorException({
        message: 'Multipart field "sessionId" must be a string when provided',
        type: 'validation',
      })
    }

    if (title !== null && typeof title !== 'string') {
      throw new DomainErrorException({
        message: 'Multipart field "title" must be a string when provided',
        type: 'validation',
      })
    }

    const result = await uploadFileCommand.execute(
      {
        config: c.get('config'),
        db: c.get('db'),
        requestId: c.get('requestId'),
        services: c.get('services'),
        tenantScope,
        traceId: c.get('traceId'),
      },
      {
        accessScope,
        file: fileEntry,
        sessionId:
          typeof sessionId === 'string' && sessionId.trim() ? asWorkSessionId(sessionId) : null,
        title: typeof title === 'string' && title.trim() ? title.trim() : null,
      },
    )

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(
      successEnvelope(
        c,
        toUploadedFileResponse(c.get('config').api.basePath, {
          file: result.value.file,
          uploadId: result.value.uploadId,
        }),
      ),
      201,
    )
  })

  return routes
}
