import assert from 'node:assert/strict'
import { test } from 'vitest'

import type { CommandContext } from '../src/application/commands/command-context'
import { generateThreadTitle } from '../src/application/naming/thread-title-generator'
import type { AiInteractionResponse } from '../src/domain/ai/types'
import type { RunRecord } from '../src/domain/runtime/run-repository'
import { asRunId, asTenantId, asWorkSessionId } from '../src/shared/ids'
import { ok } from '../src/shared/result'

test('generateThreadTitle parses assistant message text when provider outputText is empty', async () => {
  const response: AiInteractionResponse = {
    messages: [
      {
        content: [{ text: '{"title":"Sprint planning."}', type: 'text' }],
        role: 'assistant',
      },
    ],
    model: 'openai/gpt-5.4',
    output: [
      {
        content: [{ text: '{"title":"Sprint planning."}', type: 'text' }],
        role: 'assistant',
        type: 'message',
      },
    ],
    outputText: '',
    provider: 'openrouter',
    providerRequestId: null,
    raw: { stub: true },
    responseId: 'resp_thread_title_1',
    status: 'completed',
    toolCalls: [],
    usage: null,
    webSearches: [],
  }

  const context = {
    config: {
      ai: {
        defaults: {
          provider: 'openai',
        },
      },
    },
    services: {
      ai: {
        interactions: {
          generate: async () => ok(response),
        },
      },
    },
  } as unknown as CommandContext

  const run = {
    actorAccountId: null,
    agentId: null,
    agentRevisionId: null,
    completedAt: null,
    configSnapshot: {
      model: 'openai/gpt-5.4',
      provider: 'openrouter',
    },
    createdAt: '2026-04-06T10:00:00.000Z',
    errorJson: null,
    id: asRunId('run_thread_title_1'),
    jobId: null,
    lastProgressAt: null,
    parentRunId: null,
    resultJson: null,
    rootRunId: asRunId('run_thread_title_1'),
    sessionId: asWorkSessionId('ses_thread_title_1'),
    sourceCallId: null,
    staleRecoveryCount: 0,
    startedAt: '2026-04-06T10:00:00.000Z',
    status: 'completed',
    targetKind: 'assistant',
    task: 'name thread',
    tenantId: asTenantId('ten_thread_title_1'),
    threadId: null,
    toolProfileId: null,
    turnCount: 1,
    updatedAt: '2026-04-06T10:00:01.000Z',
    version: 1,
    workspaceId: null,
    workspaceRef: null,
  } satisfies RunRecord

  const generated = await generateThreadTitle(context, run, 'Plan the sprint milestones.')

  assert.equal(generated.ok, true)

  if (!generated.ok) {
    return
  }

  assert.equal(generated.value, 'Sprint planning')
})
