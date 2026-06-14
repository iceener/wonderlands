CREATE TABLE `kernel_sessions` (
	`completed_at` text,
	`created_at` text NOT NULL,
	`duration_ms` integer,
	`endpoint` text,
	`error_text` text,
	`id` text PRIMARY KEY NOT NULL,
	`policy_snapshot_json` text NOT NULL,
	`provider` text NOT NULL,
	`request_json` text NOT NULL,
	`result_json` text,
	`run_id` text NOT NULL,
	`session_id` text NOT NULL,
	`started_at` text,
	`status` text NOT NULL,
	`stderr_text` text,
	`stdout_text` text,
	`tenant_id` text NOT NULL,
	`thread_id` text,
	`tool_execution_id` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool_execution_id`) REFERENCES `tool_executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`,`session_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`session_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool_execution_id`,`tenant_id`) REFERENCES `tool_executions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `kernel_sessions_id_tenant_unique` ON `kernel_sessions` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `kernel_sessions_tenant_status_idx` ON `kernel_sessions` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `kernel_sessions_run_id_idx` ON `kernel_sessions` (`run_id`);--> statement-breakpoint
CREATE INDEX `kernel_sessions_tool_execution_id_idx` ON `kernel_sessions` (`tool_execution_id`);--> statement-breakpoint
CREATE TABLE `kernel_session_artifacts` (
	`created_at` text NOT NULL,
	`file_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`kernel_session_id` text NOT NULL,
	`metadata_json` text,
	`mime_type` text,
	`size_bytes` integer,
	`tenant_id` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kernel_session_id`) REFERENCES `kernel_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kernel_session_id`,`tenant_id`) REFERENCES `kernel_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`,`tenant_id`) REFERENCES `files`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `kernel_session_artifacts_id_tenant_unique` ON `kernel_session_artifacts` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `kernel_session_artifacts_session_idx` ON `kernel_session_artifacts` (`kernel_session_id`);--> statement-breakpoint
CREATE INDEX `kernel_session_artifacts_kind_idx` ON `kernel_session_artifacts` (`kind`);
