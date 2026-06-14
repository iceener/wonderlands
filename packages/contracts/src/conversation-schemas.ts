import { z } from "zod";

// Shared external HTTP payload contracts live here.
// Server-private recovery snapshots should stay in apps/server.
const idSchema = z.string().trim().min(1).max(200);
const nullableRecordSchema = z.record(z.string(), z.unknown()).nullable();
const providerSchema = z.enum(["openai", "google", "openrouter"]);

export const backendSessionSchema = z.object({
	archivedAt: z.string().nullable(),
	createdAt: z.string(),
	createdByAccountId: idSchema.nullable(),
	deletedAt: z.string().nullable(),
	id: idSchema,
	metadata: nullableRecordSchema,
	rootRunId: idSchema.nullable(),
	status: z.enum(["active", "archived", "deleted"]),
	tenantId: idSchema,
	title: z.string().nullable(),
	updatedAt: z.string(),
	workspaceId: idSchema.nullable(),
	workspaceRef: z.string().nullable(),
});

export const backendThreadRootJobSchema = z.object({
	currentRunId: idSchema.nullable(),
	id: idSchema,
	status: z.enum([
		"queued",
		"running",
		"waiting",
		"blocked",
		"completed",
		"cancelled",
		"superseded",
	]),
});

export const backendThreadSchema = z.object({
	branchFromMessageId: idSchema.nullable().optional(),
	branchFromSequence: z.number().int().nonnegative().nullable().optional(),
	createdAt: z.string(),
	createdByAccountId: idSchema.nullable(),
	id: idSchema,
	parentThreadId: idSchema.nullable(),
	rootJob: backendThreadRootJobSchema.nullable().optional(),
	sessionId: idSchema,
	status: z.enum(["active", "merged", "archived", "deleted"]),
	tenantId: idSchema,
	title: z.string().nullable(),
	titleSource: z
		.enum(["manual", "auto_first_message", "manual_regenerate"])
		.nullable()
		.optional(),
	updatedAt: z.string(),
});

export const bootstrapSessionAcceptedOutputSchema = z.object({
	jobId: idSchema.optional(),
	messageId: idSchema,
	runId: idSchema,
	sessionId: idSchema,
	threadId: idSchema,
});

export const postThreadMessageOutputSchema = z.object({
	messageId: idSchema,
	sequence: z.number().int().nonnegative(),
	sessionId: idSchema,
	threadId: idSchema,
});

export const backendPendingWaitSchema = z.object({
	args: z.record(z.string(), z.unknown()).nullable(),
	callId: idSchema,
	createdAt: z.string(),
	description: z.string().nullable(),
	ownerRunId: idSchema.optional(),
	requiresApproval: z.boolean().optional(),
	targetKind: z.string().trim().min(1).max(200),
	targetRef: z.string().nullable(),
	tool: z.string().trim().min(1).max(300),
	type: z.string().trim().min(1).max(100),
	waitId: idSchema,
});

export const backendUsageSchema = z
	.object({
		cachedTokens: z.number().int().nonnegative().nullable().optional(),
		inputTokens: z.number().int().nonnegative().nullable().optional(),
		outputTokens: z.number().int().nonnegative().nullable().optional(),
		reasoningTokens: z.number().int().nonnegative().nullable().optional(),
		totalTokens: z.number().int().nonnegative().nullable().optional(),
	})
	.nullable();

export const completedRunExecutionOutputSchema = z.object({
	assistantItemId: idSchema.nullable(),
	assistantMessageId: idSchema.nullable(),
	model: z.string().trim().min(1).max(200),
	outputText: z.string(),
	provider: providerSchema,
	responseId: z.string().nullable(),
	runId: idSchema,
	status: z.literal("completed"),
	usage: backendUsageSchema,
});

export const waitingRunExecutionOutputSchema = z.object({
	assistantItemId: z.null(),
	assistantMessageId: z.null(),
	model: z.string().trim().min(1).max(200),
	outputText: z.string(),
	pendingWaits: z.array(backendPendingWaitSchema),
	provider: providerSchema,
	responseId: z.string().nullable(),
	runId: idSchema,
	status: z.literal("waiting"),
	usage: backendUsageSchema,
	waitIds: z.array(idSchema),
});

export const acceptedRunResumeOutputSchema = z.object({
	runId: idSchema,
	status: z.literal("accepted"),
});

export const runExecutionOutputSchema = z.union([
	completedRunExecutionOutputSchema,
	waitingRunExecutionOutputSchema,
]);

export const resumeRunOutputSchema = z.union([
	acceptedRunResumeOutputSchema,
	runExecutionOutputSchema,
]);

export const bootstrapSessionExecutionOutputSchema = z.intersection(
	z.object({
		inputMessageId: idSchema,
		sessionId: idSchema,
		threadId: idSchema,
	}),
	runExecutionOutputSchema,
);

export const bootstrapSessionRouteOutputSchema = z.union([
	bootstrapSessionAcceptedOutputSchema,
	bootstrapSessionExecutionOutputSchema,
]);

export const cancelRunOutputSchema = z.object({
	runId: idSchema,
	status: z.enum(["cancelled", "cancelling"]),
});

export const acceptedThreadInteractionOutputSchema = z.object({
	attachedFileIds: z.array(idSchema),
	inputMessageId: idSchema,
	runId: idSchema,
	sessionId: idSchema,
	status: z.literal("accepted"),
	threadId: idSchema,
});

const legacyStartThreadInteractionOutputSchema = z.intersection(
	z.object({
		attachedFileIds: z.array(idSchema),
		inputMessageId: idSchema,
		sessionId: idSchema,
		threadId: idSchema,
	}),
	runExecutionOutputSchema,
);

export const startThreadInteractionOutputSchema = z.union([
	acceptedThreadInteractionOutputSchema,
	legacyStartThreadInteractionOutputSchema,
]);

export type BackendSessionContract = z.infer<typeof backendSessionSchema>;
export type BackendThreadRootJobContract = z.infer<
	typeof backendThreadRootJobSchema
>;
export type BackendThreadContract = z.infer<typeof backendThreadSchema>;
export type BootstrapSessionAcceptedOutputContract = z.infer<
	typeof bootstrapSessionAcceptedOutputSchema
>;
export type PostThreadMessageOutputContract = z.infer<
	typeof postThreadMessageOutputSchema
>;
export type BackendPendingWaitContract = z.infer<
	typeof backendPendingWaitSchema
>;
export type BackendUsageContract = z.infer<typeof backendUsageSchema>;
export type CompletedRunExecutionOutputContract = z.infer<
	typeof completedRunExecutionOutputSchema
>;
export type WaitingRunExecutionOutputContract = z.infer<
	typeof waitingRunExecutionOutputSchema
>;
export type AcceptedRunResumeOutputContract = z.infer<
	typeof acceptedRunResumeOutputSchema
>;
export type RunExecutionOutputContract = z.infer<
	typeof runExecutionOutputSchema
>;
export type ResumeRunOutputContract = z.infer<typeof resumeRunOutputSchema>;
export type BootstrapSessionExecutionOutputContract = z.infer<
	typeof bootstrapSessionExecutionOutputSchema
>;
export type BootstrapSessionRouteOutputContract = z.infer<
	typeof bootstrapSessionRouteOutputSchema
>;
export type CancelRunOutputContract = z.infer<typeof cancelRunOutputSchema>;
export type AcceptedThreadInteractionOutputContract = z.infer<
	typeof acceptedThreadInteractionOutputSchema
>;
export type StartThreadInteractionOutputContract = z.infer<
	typeof startThreadInteractionOutputSchema
>;
