import type { RepositoryDatabase } from '../../../domain/database-port'
import { createJobDependencyRepository } from '../../../domain/runtime/job-dependency-repository'
import { createJobRepository, type JobRecord } from '../../../domain/runtime/job-repository'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import type { DomainError } from '../../../shared/errors'
import type { SessionThreadId } from '../../../shared/ids'
import { ok, type Result } from '../../../shared/result'
import type { TenantScope } from '../../../shared/scope'

export interface JobReadModel {
  assignedAgentId: JobRecord['assignedAgentId']
  assignedAgentRevisionId: JobRecord['assignedAgentRevisionId']
  completedAt: JobRecord['completedAt']
  createdAt: JobRecord['createdAt']
  currentRunId: JobRecord['currentRunId']
  edges: Array<{
    createdAt: string
    id: string
    metadataJson: unknown | null
    toJobId: string
    type: string
  }>
  id: JobRecord['id']
  inputJson: JobRecord['inputJson']
  kind: JobRecord['kind']
  lastHeartbeatAt: JobRecord['lastHeartbeatAt']
  lastSchedulerSyncAt: JobRecord['lastSchedulerSyncAt']
  nextSchedulerCheckAt: JobRecord['nextSchedulerCheckAt']
  parentJobId: JobRecord['parentJobId']
  priority: JobRecord['priority']
  queuedAt: JobRecord['queuedAt']
  resultJson: JobRecord['resultJson']
  rootJobId: JobRecord['rootJobId']
  sessionId: JobRecord['sessionId']
  statusReasonJson: JobRecord['statusReasonJson']
  status: JobRecord['status']
  threadId: JobRecord['threadId']
  title: JobRecord['title']
  updatedAt: JobRecord['updatedAt']
  version: JobRecord['version']
}

const toJobReadModel = (
  db: RepositoryDatabase,
  scope: TenantScope,
  job: JobRecord,
): Result<JobReadModel, DomainError> => {
  const edgeRepository = createJobDependencyRepository(db)
  const edges = edgeRepository.listByFromJobId(scope, job.id)

  if (!edges.ok) {
    return edges
  }

  return ok({
    assignedAgentId: job.assignedAgentId,
    assignedAgentRevisionId: job.assignedAgentRevisionId,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    currentRunId: job.currentRunId,
    edges: edges.value.map((edge) => ({
      createdAt: edge.createdAt,
      id: edge.id,
      metadataJson: edge.metadataJson,
      toJobId: edge.toJobId,
      type: edge.type,
    })),
    id: job.id,
    inputJson: job.inputJson,
    kind: job.kind,
    lastHeartbeatAt: job.lastHeartbeatAt,
    lastSchedulerSyncAt: job.lastSchedulerSyncAt,
    nextSchedulerCheckAt: job.nextSchedulerCheckAt,
    parentJobId: job.parentJobId,
    priority: job.priority,
    queuedAt: job.queuedAt,
    resultJson: job.resultJson,
    rootJobId: job.rootJobId,
    sessionId: job.sessionId,
    statusReasonJson: job.statusReasonJson,
    status: job.status,
    threadId: job.threadId,
    title: job.title,
    updatedAt: job.updatedAt,
    version: job.version,
  })
}

export const loadRunJobReadModel = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'jobId'>,
): Result<JobReadModel | null, DomainError> => {
  if (!run.jobId) {
    return ok(null)
  }

  const jobRepository = createJobRepository(db)
  const job = jobRepository.getById(scope, run.jobId)

  if (!job.ok) {
    return job
  }

  return toJobReadModel(db, scope, job.value)
}

export const loadThreadRootJobReadModel = (
  db: RepositoryDatabase,
  scope: TenantScope,
  threadId: SessionThreadId,
): Result<JobReadModel | null, DomainError> => {
  const jobRepository = createJobRepository(db)
  const threadJobs = jobRepository.listByThreadId(scope, threadId)

  if (!threadJobs.ok) {
    return threadJobs
  }

  const latestRootJob = threadJobs.value.filter((job) => job.parentJobId === null).at(-1) ?? null

  if (!latestRootJob) {
    return ok(null)
  }

  return toJobReadModel(db, scope, latestRootJob)
}
