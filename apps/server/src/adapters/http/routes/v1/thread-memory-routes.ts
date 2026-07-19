import type { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv } from '../../../../app/types'
import { estimateObservationTokenCount } from '../../../../application/memory/observe-summary'
import { estimateReflectionTokenCount } from '../../../../application/memory/reflect-run-local-memory'
import type {
  MemoryRecordRecord,
  ObservationMemoryContent,
  ReflectionMemoryContent,
} from '../../../../domain/memory/memory-record-repository'
import { DomainErrorException } from '../../../../shared/errors'
import { asSessionThreadId } from '../../../../shared/ids'
import { createMemoryRecordRepository } from '../../../persistence/sqlite/memory/memory-record-repository'
import { successEnvelope } from '../../api-envelope'
import { authorizeThreadWrite, requireThreadAccess } from '../../route-resource-access'
import { parseJsonBodyAs, unwrapRouteResult } from '../../route-support'

const updateObservationMemoryBodySchema = z.object({
  kind: z.literal('observation'),
  observations: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(4_000),
      }),
    )
    .min(1)
    .max(8),
})

const updateReflectionMemoryBodySchema = z.object({
  kind: z.literal('reflection'),
  reflection: z.string().trim().min(1).max(4_000),
})

const updateThreadMemoryBodySchema = z.discriminatedUnion('kind', [
  updateObservationMemoryBodySchema,
  updateReflectionMemoryBodySchema,
])

const toThreadMemoryObservationRecord = (record: MemoryRecordRecord) => ({
  content: record.content,
  createdAt: record.createdAt,
  id: record.id,
  kind: 'observation' as const,
  tokenCount: record.tokenCount,
})

const toThreadMemoryReflectionRecord = (record: MemoryRecordRecord) => ({
  content: record.content,
  createdAt: record.createdAt,
  generation: record.generation,
  id: record.id,
  kind: 'reflection' as const,
  tokenCount: record.tokenCount,
})

export const registerThreadMemoryRoutes = (routes: Hono<AppEnv>): void => {
  routes.get('/:threadId/memory', async (c) => {
    const { thread, tenantScope } = requireThreadAccess(
      c,
      asSessionThreadId(c.req.param('threadId')),
    )

    const memoryRepo = createMemoryRecordRepository(c.get('db'))
    const allRecords = unwrapRouteResult(memoryRepo.listActiveByThread(tenantScope, thread.id))

    const observations = allRecords
      .filter((record) => record.kind === 'observation')
      .map(toThreadMemoryObservationRecord)

    const reflectionRecord =
      allRecords
        .filter((record) => record.kind === 'reflection')
        .sort((left, right) => right.generation - left.generation)[0] ?? null

    return c.json(
      successEnvelope(c, {
        observations,
        reflection: reflectionRecord ? toThreadMemoryReflectionRecord(reflectionRecord) : null,
      }),
      200,
    )
  })

  routes.patch('/:threadId/memory/:recordId', async (c) => {
    const parsedInput = await parseJsonBodyAs(c, updateThreadMemoryBodySchema)
    const threadId = asSessionThreadId(c.req.param('threadId'))
    const { thread, tenantScope } = authorizeThreadWrite(c, threadId)

    const memoryRepo = createMemoryRecordRepository(c.get('db'))
    const allRecords = unwrapRouteResult(memoryRepo.listActiveByThread(tenantScope, thread.id))

    const record = allRecords.find((entry) => entry.id === c.req.param('recordId'))

    if (!record) {
      throw new DomainErrorException({
        message: `memory record ${c.req.param('recordId')} was not found`,
        type: 'not_found',
      })
    }

    if (parsedInput.kind === 'observation') {
      if (record.kind !== 'observation') {
        throw new DomainErrorException({
          message: 'memory record kind does not match observation update input',
          type: 'validation',
        })
      }

      const existingContent = record.content as ObservationMemoryContent
      const nextContent: ObservationMemoryContent = {
        observations: parsedInput.observations,
        source: existingContent.source === 'observer_v1' ? existingContent.source : 'observer_v1',
      }
      const updated = memoryRepo.updateContent(tenantScope, record.id, {
        content: nextContent,
        tokenCount: estimateObservationTokenCount(nextContent),
      })

      return c.json(
        successEnvelope(c, {
          record: toThreadMemoryObservationRecord(unwrapRouteResult(updated)),
        }),
        200,
      )
    }

    if (record.kind !== 'reflection') {
      throw new DomainErrorException({
        message: 'memory record kind does not match reflection update input',
        type: 'validation',
      })
    }

    const existingContent = record.content as ReflectionMemoryContent
    const nextContent: ReflectionMemoryContent = {
      reflection: parsedInput.reflection,
      source: existingContent.source === 'reflector_v1' ? existingContent.source : 'reflector_v1',
    }
    const updated = memoryRepo.updateContent(tenantScope, record.id, {
      content: nextContent,
      tokenCount: estimateReflectionTokenCount(nextContent),
    })

    return c.json(
      successEnvelope(c, {
        record: toThreadMemoryReflectionRecord(unwrapRouteResult(updated)),
      }),
      200,
    )
  })
}
