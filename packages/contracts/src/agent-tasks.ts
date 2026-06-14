export type AgentScheduledTaskStatus =
	| "active"
	| "archived"
	| "deleted"
	| "paused";
export type AgentScheduledTaskOverlapPolicy = "skip";
export type AgentScheduledTaskRunTrigger = "manual" | "scheduled";
export type AgentScheduledTaskRunSchedulerStatus =
	| "bootstrapping"
	| "claimed"
	| "failed"
	| "queued"
	| "skipped";
export type AgentScheduledTaskRunRuntimeStatus =
	| "cancelled"
	| "cancelling"
	| "completed"
	| "failed"
	| "pending"
	| "running"
	| "waiting";
export type AgentScheduledTaskRunDisplayStatus =
	| "cancelled"
	| "completed"
	| "failed"
	| "queued"
	| "running"
	| "skipped"
	| "starting"
	| "waiting";

export interface BackendAgentScheduledTaskRun {
	completedAt: string | null;
	displayStatus: AgentScheduledTaskRunDisplayStatus;
	error: unknown | null;
	id: string;
	jobId: string | null;
	lastProgressAt: string | null;
	messageId: string | null;
	runId: string | null;
	runtimeStatus: AgentScheduledTaskRunRuntimeStatus | null;
	scheduledFor: string;
	schedulerStatus: AgentScheduledTaskRunSchedulerStatus;
	sessionId: string | null;
	taskId: string;
	threadId: string | null;
	trigger: AgentScheduledTaskRunTrigger;
}

export interface BackendAgentScheduledTask {
	agentId: string;
	agentName?: string | null;
	content: string;
	createdAt: string;
	cronExpression: string;
	description: string | null;
	id: string;
	lastAttemptId: string | null;
	lastDisplayStatus: AgentScheduledTaskRunDisplayStatus | null;
	lastError: unknown | null;
	lastJobId: string | null;
	lastMessageId: string | null;
	lastProgressAt: string | null;
	lastRunAt: string | null;
	lastRunId: string | null;
	lastSessionId: string | null;
	lastThreadId: string | null;
	name: string;
	nextRunAt: string | null;
	overlapPolicy: AgentScheduledTaskOverlapPolicy;
	ownerAccountId: string;
	status: AgentScheduledTaskStatus;
	tenantId: string;
	timezone: string;
	updatedAt: string;
}

export interface CreateAgentScheduledTaskInput {
	agentId: string;
	content: string;
	cronExpression: string;
	description?: string | null;
	name: string;
	overlapPolicy?: AgentScheduledTaskOverlapPolicy;
	status?: Extract<AgentScheduledTaskStatus, "active" | "paused">;
	timezone: string;
}

export interface UpdateAgentScheduledTaskInput {
	agentId?: string;
	content?: string;
	cronExpression?: string;
	description?: string | null;
	name?: string;
	overlapPolicy?: AgentScheduledTaskOverlapPolicy;
	status?: Extract<AgentScheduledTaskStatus, "active" | "archived" | "paused">;
	timezone?: string;
}

export interface PreviewAgentScheduledTaskScheduleInput {
	count?: number;
	cronExpression: string;
	from?: string;
	timezone: string;
}

export interface PreviewAgentScheduledTaskScheduleOutput {
	nextRunTimes: string[];
}

export interface ListAgentScheduledTasksFilters {
	agentId?: string;
	status?: AgentScheduledTaskStatus;
}

export interface RunAgentScheduledTaskNowOutput {
	taskRun: BackendAgentScheduledTaskRun;
}
