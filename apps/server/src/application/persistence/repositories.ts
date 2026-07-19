import type { RepositoryDatabase } from '../../db/repository-database'

import { createAccountPreferencesRepository } from '../../adapters/persistence/sqlite/preferences/account-preferences-repository'
import { createAgentRepository } from '../../adapters/persistence/sqlite/agents/agent-repository'
import { createAgentRevisionRepository } from '../../adapters/persistence/sqlite/agents/agent-revision-repository'
import { createAgentScheduledTaskRepository } from '../../adapters/persistence/sqlite/agent-tasks/agent-scheduled-task-repository'
import { createAgentScheduledTaskRunRepository } from '../../adapters/persistence/sqlite/agent-tasks/agent-scheduled-task-run-repository'
import { createAgentSubagentLinkRepository } from '../../adapters/persistence/sqlite/agents/agent-subagent-link-repository'
import { createApiKeyRepository } from '../../adapters/persistence/sqlite/identity/api-key-repository'
import { createAuthSessionRepository } from '../../adapters/persistence/sqlite/identity/auth-session-repository'
import { createContextSummaryRepository } from '../../adapters/persistence/sqlite/runtime/context-summary-repository'
import { createDomainEventRepository } from '../../adapters/persistence/sqlite/events/domain-event-repository'
import { createEventOutboxRepository } from '../../adapters/persistence/sqlite/events/event-outbox-repository'
import { createEventPayloadSidecarRepository } from '../../adapters/persistence/sqlite/events/event-payload-sidecar-repository'
import { createFileDeletionPlanRepository } from '../../adapters/persistence/sqlite/files/file-deletion-plan-repository'
import { createFileLinkRepository } from '../../adapters/persistence/sqlite/files/file-link-repository'
import { createFileRepository } from '../../adapters/persistence/sqlite/files/file-repository'
import { createGardenBuildRepository } from '../../adapters/persistence/sqlite/garden-build-repository.sqlite'
import { createGardenSiteRepository } from '../../adapters/persistence/sqlite/garden-site-repository.sqlite'
import { createHttpIdempotencyKeyRepository } from '../../adapters/persistence/sqlite/operations/http-idempotency-key-repository'
import { createItemRepository } from '../../adapters/persistence/sqlite/runtime/item-repository'
import { createJobDependencyRepository } from '../../adapters/persistence/sqlite/runtime/job-dependency-repository'
import { createJobRepository } from '../../adapters/persistence/sqlite/runtime/job-repository'
import { createJobRunReadinessRepository } from '../../adapters/persistence/sqlite/runtime/job-run-readiness-repository'
import { createKernelSessionArtifactRepository } from '../../adapters/persistence/sqlite/kernel/kernel-session-artifact-repository'
import { createKernelSessionRepository } from '../../adapters/persistence/sqlite/kernel/kernel-session-repository'
import { createMcpOauthAuthorizationRepository } from '../../adapters/persistence/sqlite/mcp/mcp-oauth-authorization-repository'
import { createMcpOauthCredentialRepository } from '../../adapters/persistence/sqlite/mcp/mcp-oauth-credential-repository'
import { createMcpServerRepository } from '../../adapters/persistence/sqlite/mcp/mcp-server-repository'
import { createMcpToolAssignmentRepository } from '../../adapters/persistence/sqlite/mcp/mcp-tool-assignment-repository'
import { createMcpToolCacheRepository } from '../../adapters/persistence/sqlite/mcp/mcp-tool-cache-repository'
import { createMemoryRecordRepository } from '../../adapters/persistence/sqlite/memory/memory-record-repository'
import { createMessageFileReplacementRepository } from '../../adapters/persistence/sqlite/files/message-file-replacement-repository'
import { createPasswordCredentialRepository } from '../../adapters/persistence/sqlite/identity/password-credential-repository'
import { createPendingWaitReadinessRepository } from '../../adapters/persistence/sqlite/runtime/pending-wait-readiness-repository'
import { createRunClaimRepository } from '../../adapters/persistence/sqlite/runtime/run-claim-repository'
import { createRunDependencyRepository } from '../../adapters/persistence/sqlite/runtime/run-dependency-repository'
import { createRunRepository } from '../../adapters/persistence/sqlite/runtime/run-repository'
import { createSandboxExecutionFileRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-execution-file-repository'
import { createSandboxExecutionPackageRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-package-repository'
import { createSandboxExecutionRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-execution-repository'
import { createSandboxWritebackRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-writeback-repository'
import { createSessionMessageRepository } from '../../adapters/persistence/sqlite/sessions/session-message-repository'
import { createSessionThreadRepository } from '../../adapters/persistence/sqlite/sessions/session-thread-repository'
import { createTenantMembershipRepository } from '../../adapters/persistence/sqlite/tenancy/tenant-membership-repository'
import { createThreadActivitySeenRepository } from '../../adapters/persistence/sqlite/sessions/thread-activity-seen-repository'
import { createThreadHistoryPruningRepository } from '../../adapters/persistence/sqlite/sessions/thread-history-pruning-repository'
import { createToolExecutionRepository } from '../../adapters/persistence/sqlite/runtime/tool-execution-repository'
import { createToolProfileRepository } from '../../adapters/persistence/sqlite/tool-access/tool-profile-repository'
import { createUploadRepository } from '../../adapters/persistence/sqlite/files/upload-repository'
import { createUsageLedgerRepository } from '../../adapters/persistence/sqlite/ai/usage-ledger-repository'
import { createWorkSessionRepository } from '../../adapters/persistence/sqlite/sessions/work-session-repository'
import { createWorkspaceRepository } from '../../adapters/persistence/sqlite/agents/workspace-repository'

import type { AccountPreferencesRepository } from '../../domain/preferences/account-preferences-repository'
import type { AgentRepository } from '../../domain/agents/agent-repository'
import type { AgentRevisionRepository } from '../../domain/agents/agent-revision-repository'
import type { AgentScheduledTaskRepository } from '../../domain/agent-tasks/agent-scheduled-task-repository'
import type { AgentScheduledTaskRunRepository } from '../../domain/agent-tasks/agent-scheduled-task-run-repository'
import type { AgentSubagentLinkRepository } from '../../domain/agents/agent-subagent-link-repository'
import type { ApiKeyRepository } from '../../domain/identity/api-key-repository'
import type { AuthSessionRepository } from '../../domain/identity/auth-session-repository'
import type { ContextSummaryRepository } from '../../domain/runtime/context-summary-repository'
import type { DomainEventRepository } from '../../domain/events/domain-event-repository'
import type { EventOutboxRepository } from '../../domain/events/event-outbox-repository'
import type { EventPayloadSidecarRepository } from '../../domain/events/event-payload-sidecar-repository'
import type { FileDeletionPlanRepository } from '../../domain/files/file-deletion-plan-repository'
import type { FileLinkRepository } from '../../domain/files/file-link-repository'
import type { FileRepository } from '../../domain/files/file-repository'
import type { GardenBuildRepository } from '../../domain/garden/garden-build-repository'
import type { GardenSiteRepository } from '../../domain/garden/garden-site-repository'
import type { HttpIdempotencyKeyRepository } from '../../domain/operations/http-idempotency-key-repository'
import type { ItemRepository } from '../../domain/runtime/item-repository'
import type { JobDependencyRepository } from '../../domain/runtime/job-dependency-repository'
import type { JobRepository } from '../../domain/runtime/job-repository'
import type { JobRunReadinessRepository } from '../../domain/runtime/job-run-readiness-repository'
import type { KernelSessionArtifactRepository } from '../../domain/kernel/kernel-session-artifact-repository'
import type { KernelSessionRepository } from '../../domain/kernel/kernel-session-repository'
import type { McpOauthAuthorizationRepository } from '../../domain/mcp/mcp-oauth-authorization-repository'
import type { McpOauthCredentialRepository } from '../../domain/mcp/mcp-oauth-credential-repository'
import type { McpServerRepository } from '../../domain/mcp/mcp-server-repository'
import type { McpToolAssignmentRepository } from '../../domain/mcp/mcp-tool-assignment-repository'
import type { McpToolCacheRepository } from '../../domain/mcp/mcp-tool-cache-repository'
import type { MemoryRecordRepository } from '../../domain/memory/memory-record-repository'
import type { MessageFileReplacementRepository } from '../../domain/files/message-file-replacement-repository'
import type { PasswordCredentialRepository } from '../../domain/identity/password-credential-repository'
import type { PendingWaitReadinessRepository } from '../../domain/runtime/pending-wait-readiness-repository'
import type { RunClaimRepository } from '../../domain/runtime/run-claim-repository'
import type { RunDependencyRepository } from '../../domain/runtime/run-dependency-repository'
import type { RunRepository } from '../../domain/runtime/run-repository'
import type { SandboxExecutionFileRepository } from '../../domain/sandbox/sandbox-execution-file-repository'
import type { SandboxExecutionPackageRepository } from '../../domain/sandbox/sandbox-package-repository'
import type { SandboxExecutionRepository } from '../../domain/sandbox/sandbox-execution-repository'
import type { SandboxWritebackRepository } from '../../domain/sandbox/sandbox-writeback-repository'
import type { SessionMessageRepository } from '../../domain/sessions/session-message-repository'
import type { SessionThreadRepository } from '../../domain/sessions/session-thread-repository'
import type { TenantMembershipRepository } from '../../domain/tenancy/tenant-membership-repository'
import type { ThreadActivitySeenRepository } from '../../domain/sessions/thread-activity-seen-repository'
import type { ThreadHistoryPruningRepository } from '../../domain/sessions/thread-history-pruning-repository'
import type { ToolExecutionRepository } from '../../domain/runtime/tool-execution-repository'
import type { ToolProfileRepository } from '../../domain/tool-access/tool-profile-repository'
import type { UploadRepository } from '../../domain/files/upload-repository'
import type { UsageLedgerRepository } from '../../domain/ai/usage-ledger-repository'
import type { WorkSessionRepository } from '../../domain/sessions/work-session-repository'
import type { WorkspaceRepository } from '../../domain/agents/workspace-repository'


/**
 * Centralized application persistence composition root.
 *
 * This is the ONLY module under `application/**` allowed to import concrete
 * Drizzle/SQLite repository adapters from `adapters/persistence/sqlite/**`
 * (see `test/architecture-guardrails.test.ts`). Every other application
 * module receives repository instances through this `Repositories`
 * aggregate (typically via `CommandContext.repositories`, or by calling
 * `createRepositories(tx)` locally inside a `withTransaction` callback)
 * instead of constructing concrete sqlite adapters itself.
 */
export interface Repositories {
  accountPreferences: AccountPreferencesRepository
  agent: AgentRepository
  agentRevision: AgentRevisionRepository
  agentScheduledTask: AgentScheduledTaskRepository
  agentScheduledTaskRun: AgentScheduledTaskRunRepository
  agentSubagentLink: AgentSubagentLinkRepository
  apiKey: ApiKeyRepository
  authSession: AuthSessionRepository
  contextSummary: ContextSummaryRepository
  domainEvent: DomainEventRepository
  eventOutbox: EventOutboxRepository
  eventPayloadSidecar: EventPayloadSidecarRepository
  file: FileRepository
  fileDeletionPlan: FileDeletionPlanRepository
  fileLink: FileLinkRepository
  gardenBuild: GardenBuildRepository
  gardenSite: GardenSiteRepository
  httpIdempotencyKey: HttpIdempotencyKeyRepository
  item: ItemRepository
  job: JobRepository
  jobDependency: JobDependencyRepository
  jobRunReadiness: JobRunReadinessRepository
  kernelSession: KernelSessionRepository
  kernelSessionArtifact: KernelSessionArtifactRepository
  mcpOauthAuthorization: McpOauthAuthorizationRepository
  mcpOauthCredential: McpOauthCredentialRepository
  mcpServer: McpServerRepository
  mcpToolAssignment: McpToolAssignmentRepository
  mcpToolCache: McpToolCacheRepository
  memoryRecord: MemoryRecordRepository
  messageFileReplacement: MessageFileReplacementRepository
  passwordCredential: PasswordCredentialRepository
  pendingWaitReadiness: PendingWaitReadinessRepository
  run: RunRepository
  runClaim: RunClaimRepository
  runDependency: RunDependencyRepository
  sandboxExecution: SandboxExecutionRepository
  sandboxExecutionFile: SandboxExecutionFileRepository
  sandboxExecutionPackage: SandboxExecutionPackageRepository
  sandboxWriteback: SandboxWritebackRepository
  sessionMessage: SessionMessageRepository
  sessionThread: SessionThreadRepository
  tenantMembership: TenantMembershipRepository
  threadActivitySeen: ThreadActivitySeenRepository
  threadHistoryPruning: ThreadHistoryPruningRepository
  toolExecution: ToolExecutionRepository
  toolProfile: ToolProfileRepository
  upload: UploadRepository
  usageLedger: UsageLedgerRepository
  workSession: WorkSessionRepository
  workspace: WorkspaceRepository
}

export const createRepositories = (db: RepositoryDatabase): Repositories => ({
  accountPreferences: createAccountPreferencesRepository(db),
  agent: createAgentRepository(db),
  agentRevision: createAgentRevisionRepository(db),
  agentScheduledTask: createAgentScheduledTaskRepository(db),
  agentScheduledTaskRun: createAgentScheduledTaskRunRepository(db),
  agentSubagentLink: createAgentSubagentLinkRepository(db),
  apiKey: createApiKeyRepository(db),
  authSession: createAuthSessionRepository(db),
  contextSummary: createContextSummaryRepository(db),
  domainEvent: createDomainEventRepository(db),
  eventOutbox: createEventOutboxRepository(db),
  eventPayloadSidecar: createEventPayloadSidecarRepository(db),
  file: createFileRepository(db),
  fileDeletionPlan: createFileDeletionPlanRepository(db),
  fileLink: createFileLinkRepository(db),
  gardenBuild: createGardenBuildRepository(db),
  gardenSite: createGardenSiteRepository(db),
  httpIdempotencyKey: createHttpIdempotencyKeyRepository(db),
  item: createItemRepository(db),
  job: createJobRepository(db),
  jobDependency: createJobDependencyRepository(db),
  jobRunReadiness: createJobRunReadinessRepository(db),
  kernelSession: createKernelSessionRepository(db),
  kernelSessionArtifact: createKernelSessionArtifactRepository(db),
  mcpOauthAuthorization: createMcpOauthAuthorizationRepository(db),
  mcpOauthCredential: createMcpOauthCredentialRepository(db),
  mcpServer: createMcpServerRepository(db),
  mcpToolAssignment: createMcpToolAssignmentRepository(db),
  mcpToolCache: createMcpToolCacheRepository(db),
  memoryRecord: createMemoryRecordRepository(db),
  messageFileReplacement: createMessageFileReplacementRepository(db),
  passwordCredential: createPasswordCredentialRepository(db),
  pendingWaitReadiness: createPendingWaitReadinessRepository(db),
  run: createRunRepository(db),
  runClaim: createRunClaimRepository(db),
  runDependency: createRunDependencyRepository(db),
  sandboxExecution: createSandboxExecutionRepository(db),
  sandboxExecutionFile: createSandboxExecutionFileRepository(db),
  sandboxExecutionPackage: createSandboxExecutionPackageRepository(db),
  sandboxWriteback: createSandboxWritebackRepository(db),
  sessionMessage: createSessionMessageRepository(db),
  sessionThread: createSessionThreadRepository(db),
  tenantMembership: createTenantMembershipRepository(db),
  threadActivitySeen: createThreadActivitySeenRepository(db),
  threadHistoryPruning: createThreadHistoryPruningRepository(db),
  toolExecution: createToolExecutionRepository(db),
  toolProfile: createToolProfileRepository(db),
  upload: createUploadRepository(db),
  usageLedger: createUsageLedgerRepository(db),
  workSession: createWorkSessionRepository(db),
  workspace: createWorkspaceRepository(db),
})

// Individual factory re-exports so application call sites can name a single
// repository factory (e.g. inside a `withTransaction` callback) without
// constructing the full `Repositories` aggregate, while still routing
// through this one composition module instead of `adapters/persistence/sqlite/**`.
export { createAccountPreferencesRepository } from '../../adapters/persistence/sqlite/preferences/account-preferences-repository'
export { createAgentRepository } from '../../adapters/persistence/sqlite/agents/agent-repository'
export { createAgentRevisionRepository } from '../../adapters/persistence/sqlite/agents/agent-revision-repository'
export { createAgentScheduledTaskRepository } from '../../adapters/persistence/sqlite/agent-tasks/agent-scheduled-task-repository'
export { createAgentScheduledTaskRunRepository } from '../../adapters/persistence/sqlite/agent-tasks/agent-scheduled-task-run-repository'
export { createAgentSubagentLinkRepository } from '../../adapters/persistence/sqlite/agents/agent-subagent-link-repository'
export { createApiKeyRepository } from '../../adapters/persistence/sqlite/identity/api-key-repository'
export { createAuthSessionRepository } from '../../adapters/persistence/sqlite/identity/auth-session-repository'
export { createContextSummaryRepository } from '../../adapters/persistence/sqlite/runtime/context-summary-repository'
export { createDomainEventRepository } from '../../adapters/persistence/sqlite/events/domain-event-repository'
export { createEventOutboxRepository } from '../../adapters/persistence/sqlite/events/event-outbox-repository'
export { createEventPayloadSidecarRepository } from '../../adapters/persistence/sqlite/events/event-payload-sidecar-repository'
export { createFileDeletionPlanRepository } from '../../adapters/persistence/sqlite/files/file-deletion-plan-repository'
export { createFileLinkRepository } from '../../adapters/persistence/sqlite/files/file-link-repository'
export { createFileRepository } from '../../adapters/persistence/sqlite/files/file-repository'
export { createGardenBuildRepository } from '../../adapters/persistence/sqlite/garden-build-repository.sqlite'
export { createGardenSiteRepository } from '../../adapters/persistence/sqlite/garden-site-repository.sqlite'
export { createHttpIdempotencyKeyRepository } from '../../adapters/persistence/sqlite/operations/http-idempotency-key-repository'
export { createItemRepository } from '../../adapters/persistence/sqlite/runtime/item-repository'
export { createJobDependencyRepository } from '../../adapters/persistence/sqlite/runtime/job-dependency-repository'
export { createJobRepository } from '../../adapters/persistence/sqlite/runtime/job-repository'
export { createJobRunReadinessRepository } from '../../adapters/persistence/sqlite/runtime/job-run-readiness-repository'
export { createKernelSessionArtifactRepository } from '../../adapters/persistence/sqlite/kernel/kernel-session-artifact-repository'
export { createKernelSessionRepository } from '../../adapters/persistence/sqlite/kernel/kernel-session-repository'
export { createMcpOauthAuthorizationRepository } from '../../adapters/persistence/sqlite/mcp/mcp-oauth-authorization-repository'
export { createMcpOauthCredentialRepository } from '../../adapters/persistence/sqlite/mcp/mcp-oauth-credential-repository'
export { createMcpServerRepository } from '../../adapters/persistence/sqlite/mcp/mcp-server-repository'
export { createMcpToolAssignmentRepository } from '../../adapters/persistence/sqlite/mcp/mcp-tool-assignment-repository'
export { createMcpToolCacheRepository } from '../../adapters/persistence/sqlite/mcp/mcp-tool-cache-repository'
export { createMemoryRecordRepository } from '../../adapters/persistence/sqlite/memory/memory-record-repository'
export { createMessageFileReplacementRepository } from '../../adapters/persistence/sqlite/files/message-file-replacement-repository'
export { createPasswordCredentialRepository } from '../../adapters/persistence/sqlite/identity/password-credential-repository'
export { createPendingWaitReadinessRepository } from '../../adapters/persistence/sqlite/runtime/pending-wait-readiness-repository'
export { createRunClaimRepository } from '../../adapters/persistence/sqlite/runtime/run-claim-repository'
export { createRunDependencyRepository } from '../../adapters/persistence/sqlite/runtime/run-dependency-repository'
export { createRunRepository } from '../../adapters/persistence/sqlite/runtime/run-repository'
export { createSandboxExecutionFileRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-execution-file-repository'
export { createSandboxExecutionPackageRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-package-repository'
export { createSandboxExecutionRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-execution-repository'
export { createSandboxWritebackRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-writeback-repository'
export { createSessionMessageRepository } from '../../adapters/persistence/sqlite/sessions/session-message-repository'
export { createSessionThreadRepository } from '../../adapters/persistence/sqlite/sessions/session-thread-repository'
export { createTenantMembershipRepository } from '../../adapters/persistence/sqlite/tenancy/tenant-membership-repository'
export { createThreadActivitySeenRepository } from '../../adapters/persistence/sqlite/sessions/thread-activity-seen-repository'
export { createThreadHistoryPruningRepository } from '../../adapters/persistence/sqlite/sessions/thread-history-pruning-repository'
export { createToolExecutionRepository } from '../../adapters/persistence/sqlite/runtime/tool-execution-repository'
export { createToolProfileRepository } from '../../adapters/persistence/sqlite/tool-access/tool-profile-repository'
export { createUploadRepository } from '../../adapters/persistence/sqlite/files/upload-repository'
export { createUsageLedgerRepository } from '../../adapters/persistence/sqlite/ai/usage-ledger-repository'
export { createWorkSessionRepository } from '../../adapters/persistence/sqlite/sessions/work-session-repository'
export { createWorkspaceRepository } from '../../adapters/persistence/sqlite/agents/workspace-repository'
