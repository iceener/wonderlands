import { Hono } from 'hono'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import {
  createAgentManagementService,
  type ListAgentsOptions,
  parseCreateAgentInput,
  parseMarkdownUpdateInput,
  parseUpdateAgentInput,
} from '../../../../application/agents/agent-management-service'
import {
  agentKindValues,
  agentStatusValues,
  agentVisibilityValues,
} from '../../../../domain/agents/agent-types'
import { DomainErrorException } from '../../../../shared/errors'
import { asAgentId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBody } from '../../parse-json-body'
import { unwrapRouteResult } from '../../route-support'

const toAgentManagementService = (c: Parameters<typeof requireTenantScope>[0]) =>
  createAgentManagementService({
    createId: c.get('services').ids.create,
    db: c.get('db'),
    now: () => c.get('services').clock.nowIso(),
  })

const parseListAgentsOptions = (c: Parameters<typeof requireTenantScope>[0]): ListAgentsOptions => {
  const rawKind = c.req.query('kind')
  const rawLimit = c.req.query('limit')
  const rawStatus = c.req.query('status')
  const rawVisibility = c.req.query('visibility')
  const options: ListAgentsOptions = {}

  if (rawKind && agentKindValues.includes(rawKind as (typeof agentKindValues)[number])) {
    options.kind = rawKind as ListAgentsOptions['kind']
  }

  if (rawStatus && agentStatusValues.includes(rawStatus as (typeof agentStatusValues)[number])) {
    options.status = rawStatus as ListAgentsOptions['status']
  }

  if (
    rawVisibility &&
    agentVisibilityValues.includes(rawVisibility as (typeof agentVisibilityValues)[number])
  ) {
    options.visibility = rawVisibility as ListAgentsOptions['visibility']
  }

  if (rawLimit) {
    const parsedLimit = Number.parseInt(rawLimit, 10)

    if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
      options.limit = parsedLimit
    }
  }

  return options
}

export const createAgentRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/', async (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toAgentManagementService(c).listAgents(requireTenantScope(c), parseListAgentsOptions(c)),
        ),
      ),
      200,
    )
  })

  routes.post('/', async (c) => {
    const parsedInput = parseCreateAgentInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toAgentManagementService(c).createAgent(requireTenantScope(c), parsedInput.value),
        ),
      ),
      201,
    )
  })

  routes.get('/:agentId', async (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toAgentManagementService(c).getAgentById(
            requireTenantScope(c),
            asAgentId(c.req.param('agentId')),
          ),
        ),
      ),
      200,
    )
  })

  routes.put('/:agentId', async (c) => {
    const parsedInput = parseUpdateAgentInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toAgentManagementService(c).updateAgent(
            requireTenantScope(c),
            asAgentId(c.req.param('agentId')),
            parsedInput.value,
          ),
        ),
      ),
      200,
    )
  })

  routes.delete('/:agentId', async (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toAgentManagementService(c).deleteAgent(
            requireTenantScope(c),
            asAgentId(c.req.param('agentId')),
          ),
        ),
      ),
      200,
    )
  })

  routes.get('/:agentId/markdown', async (c) => {
    const result = unwrapRouteResult(
      toAgentManagementService(c).exportAgentMarkdown(
        requireTenantScope(c),
        asAgentId(c.req.param('agentId')),
      ),
    )

    return c.json(
      successEnvelope(c, {
        agentId: result.agent.id,
        markdown: result.markdown,
        revisionId: result.revision.id,
      }),
      200,
    )
  })

  routes.put('/:agentId/markdown', async (c) => {
    const parsedInput = parseMarkdownUpdateInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toAgentManagementService(c).updateAgentMarkdown(
            requireTenantScope(c),
            asAgentId(c.req.param('agentId')),
            parsedInput.value,
          ),
        ),
      ),
      200,
    )
  })

  return routes
}
