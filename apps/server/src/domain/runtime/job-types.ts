export const jobKindValues = [
  'objective',
  'task',
  'check',
  'review',
  'sandbox',
  'tool_wait',
  'human_wait',
] as const

export type JobKind = (typeof jobKindValues)[number]

export const jobStatusValues = [
  'queued',
  'running',
  'waiting',
  'blocked',
  'completed',
  'cancelled',
  'superseded',
] as const

export type JobStatus = (typeof jobStatusValues)[number]

export const reopenableJobStatuses = new Set<JobStatus>(['blocked', 'cancelled', 'completed'])

export const jobDependencyTypeValues = [
  'depends_on',
  'produces',
  'validates',
  'supersedes',
  'related_to',
] as const

export type JobDependencyType = (typeof jobDependencyTypeValues)[number]
