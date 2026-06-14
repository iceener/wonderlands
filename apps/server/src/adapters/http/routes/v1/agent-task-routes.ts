import { Hono } from 'hono'

import type { AppEnv } from '../../../../app/types'
import {
  createAgentTaskService,
  parseCreateAgentTaskInput,
  parsePreviewAgentTaskScheduleInput,
  parseUpdateAgentTaskInput,
} from '../../../../application/agent-tasks/agent-task-service'
import { DomainErrorException } from '../../../../shared/errors'
import { asAgentScheduledTaskId, asAgentScheduledTaskRunId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBody } from '../../parse-json-body'
import { toCommandContext, unwrapRouteResult } from '../../route-support'

export const createAgentTaskRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()
  const service = createAgentTaskService()

  routes.get('/', (c) => {
    const status = c.req.query('status')
    const agentId = c.req.query('agentId')

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          service.listTasks(toCommandContext(c), {
            ...(agentId ? { agentId } : {}),
            ...(status === 'active' || status === 'paused' || status === 'archived'
              ? { status }
              : {}),
          }),
        ),
      ),
      200,
    )
  })

  routes.post('/', async (c) => {
    const parsedInput = parseCreateAgentTaskInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    const created = unwrapRouteResult(service.createTask(toCommandContext(c), parsedInput.value))

    c.get('services').agentTasks.worker.wake()

    return c.json(successEnvelope(c, created), 201)
  })

  routes.post('/preview-schedule', async (c) => {
    const parsedInput = parsePreviewAgentTaskScheduleInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          service.previewSchedule(parsedInput.value, c.get('services').clock.nowIso()),
        ),
      ),
      200,
    )
  })

  routes.get('/:taskId', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          service.getTask(toCommandContext(c), asAgentScheduledTaskId(c.req.param('taskId'))),
        ),
      ),
      200,
    )
  })

  routes.put('/:taskId', async (c) => {
    const parsedInput = parseUpdateAgentTaskInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    const updated = unwrapRouteResult(
      service.updateTask(
        toCommandContext(c),
        asAgentScheduledTaskId(c.req.param('taskId')),
        parsedInput.value,
      ),
    )

    c.get('services').agentTasks.worker.wake()

    return c.json(successEnvelope(c, updated), 200)
  })

  routes.delete('/:taskId', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          service.deleteTask(toCommandContext(c), asAgentScheduledTaskId(c.req.param('taskId'))),
        ),
      ),
      200,
    )
  })

  routes.post('/:taskId/pause', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          service.pauseTask(toCommandContext(c), asAgentScheduledTaskId(c.req.param('taskId'))),
        ),
      ),
      200,
    )
  })

  routes.post('/:taskId/resume', (c) => {
    const resumed = unwrapRouteResult(
      service.resumeTask(toCommandContext(c), asAgentScheduledTaskId(c.req.param('taskId'))),
    )

    c.get('services').agentTasks.worker.wake()

    return c.json(successEnvelope(c, resumed), 200)
  })

  routes.post('/:taskId/run-now', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          service.runTaskNow(toCommandContext(c), asAgentScheduledTaskId(c.req.param('taskId'))),
        ),
      ),
      201,
    )
  })

  routes.get('/:taskId/runs', (c) => {
    const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10)

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          service.listTaskRuns(
            toCommandContext(c),
            asAgentScheduledTaskId(c.req.param('taskId')),
            Number.isNaN(limitParam) ? {} : { limit: Math.min(Math.max(limitParam, 1), 200) },
          ),
        ),
      ),
      200,
    )
  })

  routes.get('/:taskId/runs/:taskRunId', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          service.getTaskRun(
            toCommandContext(c),
            asAgentScheduledTaskId(c.req.param('taskId')),
            asAgentScheduledTaskRunId(c.req.param('taskRunId')),
          ),
        ),
      ),
      200,
    )
  })

  return routes
}
