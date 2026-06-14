import { and, eq } from 'drizzle-orm'
import type { AppRuntime } from '../../src/app/runtime'
import { accountPreferences, agentRevisions, agents, jobs, runs } from '../../src/db/schema'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readNativeTools = (value: unknown): string[] => {
  if (!isRecord(value) || !Array.isArray(value.native)) {
    return []
  }

  return value.native.filter((candidate): candidate is string => typeof candidate === 'string')
}

export const grantNativeToolToDefaultAgent = (runtime: AppRuntime, toolName: string) => {
  const preferences = runtime.db.select().from(accountPreferences).get()

  if (!preferences) {
    return null
  }

  const createdAt = '2026-03-29T00:00:00.000Z'
  const accountSuffix = preferences.accountId.replace(/^acc_/, '') || preferences.accountId
  const agentId = `agt_test_native_${accountSuffix}`
  const revisionId = `agr_test_native_${accountSuffix}_v1`
  const currentRevision = runtime.db
    .select()
    .from(agentRevisions)
    .where(eq(agentRevisions.id, revisionId))
    .get()
  const nativeTools = [...new Set([...readNativeTools(currentRevision?.toolPolicyJson), toolName])]

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: revisionId,
      archivedAt: null,
      baseAgentId: null,
      createdAt,
      createdByAccountId: preferences.accountId,
      id: agentId,
      kind: 'primary',
      name: 'Native Tool Test Agent',
      ownerAccountId: preferences.accountId,
      slug: `native-tools-${accountSuffix}`,
      status: 'active',
      tenantId: preferences.tenantId,
      updatedAt: createdAt,
      visibility: 'account_private',
    })
    .onConflictDoUpdate({
      set: {
        activeRevisionId: revisionId,
        updatedAt: createdAt,
      },
      target: agents.id,
    })
    .run()

  runtime.db
    .insert(agentRevisions)
    .values({
      agentId,
      checksumSha256: `${revisionId}_checksum`,
      createdAt,
      createdByAccountId: preferences.accountId,
      frontmatterJson: {
        agent_id: agentId,
        kind: 'primary',
        name: 'Native Tool Test Agent',
        revision_id: revisionId,
        schema: 'agent/v1',
        slug: `native-tools-${accountSuffix}`,
        visibility: 'account_private',
      },
      gardenFocusJson: {},
      id: revisionId,
      instructionsMd: 'Execute native tools for runtime tests.',
      kernelPolicyJson: {},
      memoryPolicyJson: {},
      modelConfigJson: {
        modelAlias: 'gpt-5.4',
        provider: 'openai',
      },
      resolvedConfigJson: {},
      sandboxPolicyJson: {},
      sourceMarkdown:
        '---\n' +
        'schema: agent/v1\n' +
        'kind: primary\n' +
        `name: Native Tool Test Agent\n` +
        `slug: native-tools-${accountSuffix}\n` +
        'visibility: account_private\n' +
        `agent_id: ${agentId}\n` +
        `revision_id: ${revisionId}\n` +
        '---\n' +
        'Execute native tools for runtime tests.\n',
      tenantId: preferences.tenantId,
      toolPolicyJson: {
        native: nativeTools,
        ...(preferences.assistantToolProfileId
          ? {
              toolProfileId: preferences.assistantToolProfileId,
            }
          : {}),
      },
      toolProfileId: preferences.assistantToolProfileId,
      version: 1,
      workspacePolicyJson: {},
    })
    .onConflictDoUpdate({
      set: {
        toolPolicyJson: {
          native: nativeTools,
          ...(preferences.assistantToolProfileId
            ? {
                toolProfileId: preferences.assistantToolProfileId,
              }
            : {}),
        },
        toolProfileId: preferences.assistantToolProfileId,
      },
      target: agentRevisions.id,
    })
    .run()

  runtime.db
    .update(accountPreferences)
    .set({
      defaultAgentId: agentId,
      defaultTargetKind: 'agent',
      updatedAt: createdAt,
    })
    .where(
      and(
        eq(accountPreferences.accountId, preferences.accountId),
        eq(accountPreferences.tenantId, preferences.tenantId),
      ),
    )
    .run()

  const unboundRunIds = runtime.db
    .select()
    .from(runs)
    .all()
    .filter((run) => run.tenantId === preferences.tenantId && run.agentRevisionId === null)
    .map((run) => run.id)

  for (const runId of unboundRunIds) {
    runtime.db
      .update(runs)
      .set({
        agentId,
        agentRevisionId: revisionId,
        targetKind: 'agent',
        updatedAt: createdAt,
      })
      .where(eq(runs.id, runId))
      .run()

    runtime.db
      .update(jobs)
      .set({
        assignedAgentId: agentId,
        assignedAgentRevisionId: revisionId,
        updatedAt: createdAt,
      })
      .where(eq(jobs.currentRunId, runId))
      .run()
  }

  return {
    agentId,
    revisionId,
    toolProfileId: preferences.assistantToolProfileId,
  }
}
