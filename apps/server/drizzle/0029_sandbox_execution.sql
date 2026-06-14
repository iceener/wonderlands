ALTER TABLE `agent_revisions` ADD `sandbox_policy_json` text NOT NULL DEFAULT '{}';--> statement-breakpoint
CREATE TABLE `sandbox_executions` (
	`completed_at` text,
	`created_at` text NOT NULL,
	`duration_ms` integer,
	`error_text` text,
	`external_sandbox_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`network_mode` text NOT NULL,
	`policy_snapshot_json` text NOT NULL,
	`provider` text NOT NULL,
	`queued_at` text,
	`request_json` text NOT NULL,
	`run_id` text NOT NULL,
	`runtime` text NOT NULL,
	`session_id` text NOT NULL,
	`started_at` text,
	`status` text NOT NULL,
	`stderr_text` text,
	`stdout_text` text,
	`tenant_id` text NOT NULL,
	`thread_id` text,
	`tool_execution_id` text,
	`vault_access_mode` text NOT NULL,
	`workspace_id` text,
	`workspace_ref` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool_execution_id`) REFERENCES `tool_executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`,`session_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`session_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool_execution_id`,`tenant_id`) REFERENCES `tool_executions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`,`tenant_id`) REFERENCES `jobs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`tenant_id`) REFERENCES `workspaces`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_executions_id_tenant_unique` ON `sandbox_executions` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `sandbox_executions_tenant_status_idx` ON `sandbox_executions` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `sandbox_executions_run_id_idx` ON `sandbox_executions` (`run_id`);--> statement-breakpoint
CREATE INDEX `sandbox_executions_job_id_idx` ON `sandbox_executions` (`job_id`);--> statement-breakpoint
CREATE INDEX `sandbox_executions_tool_execution_id_idx` ON `sandbox_executions` (`tool_execution_id`);--> statement-breakpoint
CREATE TABLE `sandbox_execution_files` (
	`checksum_sha256` text,
	`created_at` text NOT NULL,
	`created_file_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`mime_type` text,
	`role` text NOT NULL,
	`sandbox_execution_id` text NOT NULL,
	`sandbox_path` text NOT NULL,
	`size_bytes` integer,
	`source_file_id` text,
	`source_vault_path` text,
	`target_vault_path` text,
	`tenant_id` text NOT NULL,
	FOREIGN KEY (`created_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sandbox_execution_id`) REFERENCES `sandbox_executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sandbox_execution_id`,`tenant_id`) REFERENCES `sandbox_executions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_file_id`,`tenant_id`) REFERENCES `files`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_file_id`,`tenant_id`) REFERENCES `files`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_execution_files_id_tenant_unique` ON `sandbox_execution_files` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `sandbox_execution_files_execution_idx` ON `sandbox_execution_files` (`sandbox_execution_id`);--> statement-breakpoint
CREATE INDEX `sandbox_execution_files_role_idx` ON `sandbox_execution_files` (`role`);--> statement-breakpoint
CREATE TABLE `sandbox_execution_packages` (
	`created_at` text NOT NULL,
	`error_text` text,
	`id` text PRIMARY KEY NOT NULL,
	`install_scripts_allowed` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`registry_host` text,
	`requested_version` text NOT NULL,
	`resolved_version` text,
	`sandbox_execution_id` text NOT NULL,
	`status` text NOT NULL,
	`tenant_id` text NOT NULL,
	FOREIGN KEY (`sandbox_execution_id`) REFERENCES `sandbox_executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sandbox_execution_id`,`tenant_id`) REFERENCES `sandbox_executions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_execution_packages_id_tenant_unique` ON `sandbox_execution_packages` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `sandbox_execution_packages_execution_idx` ON `sandbox_execution_packages` (`sandbox_execution_id`);--> statement-breakpoint
CREATE INDEX `sandbox_execution_packages_status_idx` ON `sandbox_execution_packages` (`status`);--> statement-breakpoint
CREATE TABLE `sandbox_writeback_operations` (
	`applied_at` text,
	`approved_at` text,
	`approved_by_account_id` text,
	`created_at` text NOT NULL,
	`error_text` text,
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`requires_approval` integer DEFAULT true NOT NULL,
	`sandbox_execution_id` text NOT NULL,
	`source_sandbox_path` text NOT NULL,
	`status` text NOT NULL,
	`target_vault_path` text NOT NULL,
	`tenant_id` text NOT NULL,
	FOREIGN KEY (`approved_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sandbox_execution_id`) REFERENCES `sandbox_executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sandbox_execution_id`,`tenant_id`) REFERENCES `sandbox_executions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_writeback_operations_id_tenant_unique` ON `sandbox_writeback_operations` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `sandbox_writeback_operations_execution_idx` ON `sandbox_writeback_operations` (`sandbox_execution_id`);--> statement-breakpoint
CREATE INDEX `sandbox_writeback_operations_status_idx` ON `sandbox_writeback_operations` (`status`);
