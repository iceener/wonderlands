CREATE TABLE `context_summaries` (
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`from_sequence` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`model_key` text NOT NULL,
	`previous_summary_id` text,
	`run_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`through_sequence` integer NOT NULL,
	`tokens_after` integer,
	`tokens_before` integer,
	`turn_number` integer,
	FOREIGN KEY (`previous_summary_id`) REFERENCES `context_summaries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "context_summaries_sequence_rule" CHECK("context_summaries"."from_sequence" <= "context_summaries"."through_sequence")
);
--> statement-breakpoint
CREATE INDEX `context_summaries_tenant_id_idx` ON `context_summaries` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `context_summaries_run_id_idx` ON `context_summaries` (`run_id`);--> statement-breakpoint
CREATE INDEX `context_summaries_run_through_sequence_idx` ON `context_summaries` (`run_id`,`through_sequence`);--> statement-breakpoint
CREATE TABLE `run_claims` (
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`renewed_at` text NOT NULL,
	`run_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`worker_id` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `run_claims_tenant_id_idx` ON `run_claims` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `run_claims_expires_at_idx` ON `run_claims` (`expires_at`);--> statement-breakpoint
CREATE TABLE `file_links` (
	`created_at` text NOT NULL,
	`file_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`link_type` text NOT NULL,
	`target_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_links_file_link_target_unique` ON `file_links` (`file_id`,`link_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `file_links_target_idx` ON `file_links` (`link_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `file_links_tenant_id_idx` ON `file_links` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`checksum_sha256` text,
	`created_at` text NOT NULL,
	`created_by_account_id` text,
	`created_by_run_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`metadata` text,
	`mime_type` text,
	`original_filename` text,
	`size_bytes` integer,
	`source_kind` text NOT NULL,
	`status` text NOT NULL,
	`storage_key` text NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `files_tenant_id_idx` ON `files` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `files_created_by_run_id_idx` ON `files` (`created_by_run_id`);--> statement-breakpoint
CREATE INDEX `files_tenant_source_kind_idx` ON `files` (`tenant_id`,`source_kind`);--> statement-breakpoint
CREATE INDEX `files_tenant_checksum_idx` ON `files` (`tenant_id`,`checksum_sha256`);--> statement-breakpoint
ALTER TABLE `usage_ledger` ADD `summary_id` text REFERENCES context_summaries(id);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`completed_at` text,
	`config_snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	`error_json` text,
	`id` text PRIMARY KEY NOT NULL,
	`last_progress_at` text,
	`parent_run_id` text,
	`profile` text NOT NULL,
	`result_json` text,
	`root_run_id` text NOT NULL,
	`session_id` text NOT NULL,
	`source_call_id` text,
	`started_at` text,
	`status` text NOT NULL,
	`task` text NOT NULL,
	`tenant_id` text NOT NULL,
	`thread_id` text,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`workspace_ref` text,
	FOREIGN KEY (`parent_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "runs_root_run_rule" CHECK((("__new_runs"."parent_run_id" is null and "__new_runs"."root_run_id" = "__new_runs"."id") or ("__new_runs"."parent_run_id" is not null and "__new_runs"."root_run_id" <> "__new_runs"."id")))
);
--> statement-breakpoint
INSERT INTO `__new_runs`("completed_at", "config_snapshot", "created_at", "error_json", "id", "last_progress_at", "parent_run_id", "profile", "result_json", "root_run_id", "session_id", "source_call_id", "started_at", "status", "task", "tenant_id", "thread_id", "turn_count", "updated_at", "version", "workspace_ref") SELECT "completed_at", "config_snapshot", "created_at", "error_json", "id", "last_progress_at", "parent_run_id", "profile", "result_json", "root_run_id", "session_id", "source_call_id", "started_at", "status", "task", "tenant_id", "thread_id", "turn_count", "updated_at", "version", "workspace_ref" FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `runs_tenant_id_idx` ON `runs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `runs_session_id_idx` ON `runs` (`session_id`);--> statement-breakpoint
CREATE INDEX `runs_thread_id_idx` ON `runs` (`thread_id`);--> statement-breakpoint
CREATE INDEX `runs_parent_run_id_idx` ON `runs` (`parent_run_id`);--> statement-breakpoint
CREATE INDEX `runs_root_run_id_idx` ON `runs` (`root_run_id`);--> statement-breakpoint
CREATE INDEX `runs_session_status_idx` ON `runs` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `runs_root_status_idx` ON `runs` (`root_run_id`,`status`);--> statement-breakpoint
CREATE INDEX `runs_status_progress_idx` ON `runs` (`status`,`last_progress_at`);--> statement-breakpoint
CREATE TABLE `__new_run_dependencies` (
	`call_id` text NOT NULL,
	`created_at` text NOT NULL,
	`description` text,
	`id` text PRIMARY KEY NOT NULL,
	`resolution_json` text,
	`resolved_at` text,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_ref` text,
	`target_run_id` text,
	`tenant_id` text NOT NULL,
	`timeout_at` text,
	`type` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "run_dependencies_agent_target_rule" CHECK((("__new_run_dependencies"."type" = 'agent' and "__new_run_dependencies"."target_kind" = 'run' and "__new_run_dependencies"."target_run_id" is not null) or ("__new_run_dependencies"."type" <> 'agent' and "__new_run_dependencies"."target_run_id" is null)))
);
--> statement-breakpoint
INSERT INTO `__new_run_dependencies`("call_id", "created_at", "description", "id", "resolution_json", "resolved_at", "run_id", "status", "target_kind", "target_ref", "target_run_id", "tenant_id", "timeout_at", "type") SELECT "call_id", "created_at", "description", "id", "resolution_json", "resolved_at", "run_id", "status", "target_kind", "target_ref", "target_run_id", "tenant_id", "timeout_at", "type" FROM `run_dependencies`;--> statement-breakpoint
DROP TABLE `run_dependencies`;--> statement-breakpoint
ALTER TABLE `__new_run_dependencies` RENAME TO `run_dependencies`;--> statement-breakpoint
CREATE INDEX `run_dependencies_run_status_idx` ON `run_dependencies` (`run_id`,`status`);--> statement-breakpoint
CREATE INDEX `run_dependencies_target_run_id_idx` ON `run_dependencies` (`target_run_id`);--> statement-breakpoint
CREATE INDEX `run_dependencies_target_kind_ref_idx` ON `run_dependencies` (`target_kind`,`target_ref`);--> statement-breakpoint
CREATE INDEX `run_dependencies_run_call_id_idx` ON `run_dependencies` (`run_id`,`call_id`);--> statement-breakpoint
CREATE INDEX `run_dependencies_timeout_at_idx` ON `run_dependencies` (`timeout_at`);