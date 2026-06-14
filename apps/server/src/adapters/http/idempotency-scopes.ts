const unique = (values: string[]): string[] => [...new Set(values)]

const legacyApiBasePaths = (configuredBasePath: string): string[] =>
  unique([configuredBasePath, '/api', '/v1'])

const toLegacyPostScopes = (configuredBasePath: string, pathSuffix: string): string[] =>
  legacyApiBasePaths(configuredBasePath).map((basePath) => `POST ${basePath}${pathSuffix}`)

export const idempotencyScopes = {
  runCancel: (runId: string) => `run.cancel:${runId}`,
  runExecute: (runId: string) => `run.execute:${runId}`,
  runResume: (runId: string) => `run.resume:${runId}`,
  sessionBootstrap: () => 'session.bootstrap',
  sessionCreate: () => 'session.create',
  sessionThreadCreate: (sessionId: string) => `session.thread.create:${sessionId}`,
  threadBranchCreate: (threadId: string) => `thread.branch.create:${threadId}`,
  threadInteractionStart: (threadId: string) => `thread.interaction.start:${threadId}`,
  threadMessagePost: (threadId: string) => `thread.message.post:${threadId}`,
} as const

export const legacyIdempotencyScopes = {
  runCancel: (configuredBasePath: string, runId: string) =>
    toLegacyPostScopes(configuredBasePath, `/runs/${runId}/cancel`),
  runExecute: (configuredBasePath: string, runId: string) =>
    toLegacyPostScopes(configuredBasePath, `/runs/${runId}/execute`),
  runResume: (configuredBasePath: string, runId: string) =>
    toLegacyPostScopes(configuredBasePath, `/runs/${runId}/resume`),
  sessionBootstrap: (configuredBasePath: string) =>
    toLegacyPostScopes(configuredBasePath, '/sessions/bootstrap'),
  sessionCreate: (configuredBasePath: string) =>
    toLegacyPostScopes(configuredBasePath, '/sessions'),
  sessionThreadCreate: (configuredBasePath: string, sessionId: string) =>
    toLegacyPostScopes(configuredBasePath, `/sessions/${sessionId}/threads`),
  threadBranchCreate: (configuredBasePath: string, threadId: string) =>
    toLegacyPostScopes(configuredBasePath, `/threads/${threadId}/branches`),
  threadInteractionStart: (configuredBasePath: string, threadId: string) =>
    toLegacyPostScopes(configuredBasePath, `/threads/${threadId}/interactions`),
  threadMessagePost: (configuredBasePath: string, threadId: string) =>
    toLegacyPostScopes(configuredBasePath, `/threads/${threadId}/messages`),
} as const
