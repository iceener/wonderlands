import { Hono } from 'hono'

import type { AppConfig } from '../../../../app/config'
import type { AppEnv } from '../../../../app/types'
import { successEnvelope } from '../../api-envelope'
import { createAccountRoutes } from './account-routes'
import { createAgentRoutes } from './agent-routes'
import { createAgentTaskRoutes } from './agent-task-routes'
import { createAuthRoutes } from './auth-routes'
import { createEventRoutes } from './event-routes'
import { createFilePickerRoutes } from './file-picker-routes'
import { createFileRoutes } from './file-routes'
import { createGardenRoutes } from './garden-routes'
import { createMcpRoutes } from './mcp-routes'
import { createRunRoutes } from './run-routes'
import { createSessionRoutes } from './session-routes'
import { createSystemRoutes } from './system-routes'
import { createThreadRoutes } from './thread-routes'
import { createToolProfileRoutes } from './tool-profile-routes'
import { createUploadRoutes } from './upload-routes'

export const createApiRoutes = (config: AppConfig): Hono<AppEnv> => {
  const api = new Hono<AppEnv>()

  api.get('/', (c) => {
    return c.json(
      successEnvelope(c, {
        apiBasePath: config.api.basePath,
        name: config.app.name,
        status: 'ok',
        version: config.api.version,
      }),
    )
  })

  api.route('/system', createSystemRoutes())
  api.route('/tool-profiles', createToolProfileRoutes())
  api.route('/auth', createAuthRoutes())
  api.route('/account', createAccountRoutes())
  api.route('/agents', createAgentRoutes())
  api.route('/agent-tasks', createAgentTaskRoutes())
  api.route('/gardens', createGardenRoutes())
  api.route('/mcp', createMcpRoutes())
  api.route('/runs', createRunRoutes())
  api.route('/sessions', createSessionRoutes())
  api.route('/threads', createThreadRoutes())
  api.route('/events', createEventRoutes())
  api.route('/files', createFileRoutes())
  api.route('/file-picker', createFilePickerRoutes())
  api.route('/uploads', createUploadRoutes())

  return api
}
