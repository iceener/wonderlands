PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_id_tenant_unique` ON `runs` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `work_sessions_id_tenant_unique` ON `work_sessions` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_threads_id_session_tenant_unique` ON `session_threads` (`id`,`session_id`,`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_context_summaries` (
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
	FOREIGN KEY (`run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "context_summaries_sequence_rule" CHECK("__new_context_summaries"."from_sequence" <= "__new_context_summaries"."through_sequence")
);
--> statement-breakpoint
INSERT INTO `__new_context_summaries`("content", "created_at", "from_sequence", "id", "model_key", "previous_summary_id", "run_id", "tenant_id", "through_sequence", "tokens_after", "tokens_before", "turn_number") SELECT "content", "created_at", "from_sequence", "id", "model_key", "previous_summary_id", "run_id", "tenant_id", "through_sequence", "tokens_after", "tokens_before", "turn_number" FROM `context_summaries`;--> statement-breakpoint
DROP TABLE `context_summaries`;--> statement-breakpoint
ALTER TABLE `__new_context_summaries` RENAME TO `context_summaries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `context_summaries_id_tenant_unique` ON `context_summaries` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `context_summaries_tenant_id_idx` ON `context_summaries` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `context_summaries_run_id_idx` ON `context_summaries` (`run_id`);--> statement-breakpoint
CREATE INDEX `context_summaries_run_through_sequence_idx` ON `context_summaries` (`run_id`,`through_sequence`);--> statement-breakpoint
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
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`,`session_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`session_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "runs_root_run_rule" CHECK((("__new_runs"."parent_run_id" is null and "__new_runs"."root_run_id" = "__new_runs"."id") or ("__new_runs"."parent_run_id" is not null and "__new_runs"."root_run_id" <> "__new_runs"."id")))
);
--> statement-breakpoint
INSERT INTO `__new_runs`("completed_at", "config_snapshot", "created_at", "error_json", "id", "last_progress_at", "parent_run_id", "profile", "result_json", "root_run_id", "session_id", "source_call_id", "started_at", "status", "task", "tenant_id", "thread_id", "turn_count", "updated_at", "version", "workspace_ref") SELECT "completed_at", "config_snapshot", "created_at", "error_json", "id", "last_progress_at", "parent_run_id", "profile", "result_json", "root_run_id", "session_id", "source_call_id", "started_at", "status", "task", "tenant_id", "thread_id", "turn_count", "updated_at", "version", "workspace_ref" FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_id_tenant_unique` ON `runs` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_id_tenant_session_root_unique` ON `runs` (`id`,`tenant_id`,`session_id`,`root_run_id`);--> statement-breakpoint
CREATE INDEX `runs_tenant_id_idx` ON `runs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `runs_session_id_idx` ON `runs` (`session_id`);--> statement-breakpoint
CREATE INDEX `runs_thread_id_idx` ON `runs` (`thread_id`);--> statement-breakpoint
CREATE INDEX `runs_parent_run_id_idx` ON `runs` (`parent_run_id`);--> statement-breakpoint
CREATE INDEX `runs_root_run_id_idx` ON `runs` (`root_run_id`);--> statement-breakpoint
CREATE INDEX `runs_session_status_idx` ON `runs` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `runs_root_status_idx` ON `runs` (`root_run_id`,`status`);--> statement-breakpoint
CREATE INDEX `runs_status_progress_idx` ON `runs` (`status`,`last_progress_at`);--> statement-breakpoint
CREATE TABLE `__new_session_threads` (
	`created_at` text NOT NULL,
	`created_by_account_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`parent_thread_id` text,
	`session_id` text NOT NULL,
	`status` text NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_session_threads`("created_at", "created_by_account_id", "id", "parent_thread_id", "session_id", "status", "tenant_id", "title", "updated_at") SELECT "created_at", "created_by_account_id", "id", "parent_thread_id", "session_id", "status", "tenant_id", "title", "updated_at" FROM `session_threads`;--> statement-breakpoint
DROP TABLE `session_threads`;--> statement-breakpoint
ALTER TABLE `__new_session_threads` RENAME TO `session_threads`;--> statement-breakpoint
CREATE UNIQUE INDEX `session_threads_id_tenant_unique` ON `session_threads` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_threads_id_session_tenant_unique` ON `session_threads` (`id`,`session_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `session_threads_tenant_id_idx` ON `session_threads` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `session_threads_session_id_idx` ON `session_threads` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_threads_parent_thread_id_idx` ON `session_threads` (`parent_thread_id`);--> statement-breakpoint
CREATE INDEX `session_threads_session_status_idx` ON `session_threads` (`session_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_tool_executions` (
	`args_json` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`domain` text NOT NULL,
	`duration_ms` integer,
	`error_text` text,
	`id` text PRIMARY KEY NOT NULL,
	`outcome_json` text,
	`run_id` text NOT NULL,
	`started_at` text,
	`tenant_id` text NOT NULL,
	`tool` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tool_executions`("args_json", "completed_at", "created_at", "domain", "duration_ms", "error_text", "id", "outcome_json", "run_id", "started_at", "tenant_id", "tool") SELECT "args_json", "completed_at", "created_at", "domain", "duration_ms", "error_text", "id", "outcome_json", "run_id", "started_at", "tenant_id", "tool" FROM `tool_executions`;--> statement-breakpoint
DROP TABLE `tool_executions`;--> statement-breakpoint
ALTER TABLE `__new_tool_executions` RENAME TO `tool_executions`;--> statement-breakpoint
CREATE UNIQUE INDEX `tool_executions_id_tenant_unique` ON `tool_executions` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `tool_executions_tenant_id_idx` ON `tool_executions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `tool_executions_run_id_idx` ON `tool_executions` (`run_id`);--> statement-breakpoint
CREATE INDEX `tool_executions_tool_idx` ON `tool_executions` (`tool`);--> statement-breakpoint
CREATE INDEX `tool_executions_run_tool_idx` ON `tool_executions` (`run_id`,`tool`);--> statement-breakpoint
CREATE INDEX `tool_executions_domain_idx` ON `tool_executions` (`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_events_id_tenant_unique` ON `domain_events` (`id`,`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_files` (
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_files`("checksum_sha256", "created_at", "created_by_account_id", "created_by_run_id", "id", "metadata", "mime_type", "original_filename", "size_bytes", "source_kind", "status", "storage_key", "tenant_id", "title", "updated_at") SELECT "checksum_sha256", "created_at", "created_by_account_id", "created_by_run_id", "id", "metadata", "mime_type", "original_filename", "size_bytes", "source_kind", "status", "storage_key", "tenant_id", "title", "updated_at" FROM `files`;--> statement-breakpoint
DROP TABLE `files`;--> statement-breakpoint
ALTER TABLE `__new_files` RENAME TO `files`;--> statement-breakpoint
CREATE UNIQUE INDEX `files_id_tenant_unique` ON `files` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `files_tenant_id_idx` ON `files` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `files_created_by_run_id_idx` ON `files` (`created_by_run_id`);--> statement-breakpoint
CREATE INDEX `files_tenant_source_kind_idx` ON `files` (`tenant_id`,`source_kind`);--> statement-breakpoint
CREATE INDEX `files_tenant_checksum_idx` ON `files` (`tenant_id`,`checksum_sha256`);--> statement-breakpoint
CREATE TABLE `__new_items` (
	`arguments` text,
	`call_id` text,
	`content` text,
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`output` text,
	`provider_payload` text,
	`role` text,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`summary` text,
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "items_type_payload_rule" CHECK((
        ("__new_items"."type" = 'message' and "__new_items"."role" is not null and "__new_items"."content" is not null) or
        ("__new_items"."type" = 'function_call' and "__new_items"."call_id" is not null and "__new_items"."name" is not null and "__new_items"."arguments" is not null) or
        ("__new_items"."type" = 'function_call_output' and "__new_items"."call_id" is not null and "__new_items"."output" is not null) or
        ("__new_items"."type" = 'reasoning' and "__new_items"."summary" is not null and "__new_items"."role" is null)
      ))
);
--> statement-breakpoint
INSERT INTO `__new_items`("arguments", "call_id", "content", "created_at", "id", "name", "output", "provider_payload", "role", "run_id", "sequence", "summary", "tenant_id", "type") SELECT "arguments", "call_id", "content", "created_at", "id", "name", "output", "provider_payload", "role", "run_id", "sequence", "summary", "tenant_id", "type" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
CREATE INDEX `items_tenant_id_idx` ON `items` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_run_sequence_unique` ON `items` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `items_run_call_id_idx` ON `items` (`run_id`,`call_id`);--> statement-breakpoint
CREATE INDEX `items_call_id_idx` ON `items` (`call_id`);--> statement-breakpoint
CREATE TABLE `__new_run_claims` (
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`renewed_at` text NOT NULL,
	`run_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`worker_id` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_run_claims`("acquired_at", "expires_at", "renewed_at", "run_id", "tenant_id", "worker_id") SELECT "acquired_at", "expires_at", "renewed_at", "run_id", "tenant_id", "worker_id" FROM `run_claims`;--> statement-breakpoint
DROP TABLE `run_claims`;--> statement-breakpoint
ALTER TABLE `__new_run_claims` RENAME TO `run_claims`;--> statement-breakpoint
CREATE INDEX `run_claims_tenant_id_idx` ON `run_claims` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `run_claims_expires_at_idx` ON `run_claims` (`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_session_messages` (
	`author_account_id` text,
	`author_kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`metadata` text,
	`run_id` text,
	`sequence` integer NOT NULL,
	`session_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`thread_id` text NOT NULL,
	FOREIGN KEY (`author_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`,`session_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`session_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_session_messages`("author_account_id", "author_kind", "content", "created_at", "id", "metadata", "run_id", "sequence", "session_id", "tenant_id", "thread_id") SELECT "author_account_id", "author_kind", "content", "created_at", "id", "metadata", "run_id", "sequence", "session_id", "tenant_id", "thread_id" FROM `session_messages`;--> statement-breakpoint
DROP TABLE `session_messages`;--> statement-breakpoint
ALTER TABLE `__new_session_messages` RENAME TO `session_messages`;--> statement-breakpoint
CREATE INDEX `session_messages_tenant_id_idx` ON `session_messages` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_messages_thread_sequence_unique` ON `session_messages` (`thread_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `session_messages_session_id_idx` ON `session_messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_messages_run_id_idx` ON `session_messages` (`run_id`);--> statement-breakpoint
CREATE TABLE `__new_usage_ledger` (
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer,
	`created_at` text NOT NULL,
	`estimated_input_tokens` integer,
	`estimated_output_tokens` integer,
	`id` text PRIMARY KEY NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`model` text NOT NULL,
	`operation` text NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`provider` text NOT NULL,
	`run_id` text,
	`session_id` text,
	`summary_id` text,
	`tenant_id` text NOT NULL,
	`thread_id` text,
	`tool_execution_id` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`summary_id`) REFERENCES `context_summaries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool_execution_id`) REFERENCES `tool_executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool_execution_id`,`tenant_id`) REFERENCES `tool_executions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_usage_ledger`("cached_tokens", "cost_micros", "created_at", "estimated_input_tokens", "estimated_output_tokens", "id", "input_tokens", "model", "operation", "output_tokens", "provider", "run_id", "session_id", "summary_id", "tenant_id", "thread_id", "tool_execution_id") SELECT "cached_tokens", "cost_micros", "created_at", "estimated_input_tokens", "estimated_output_tokens", "id", "input_tokens", "model", "operation", "output_tokens", "provider", "run_id", "session_id", "summary_id", "tenant_id", "thread_id", "tool_execution_id" FROM `usage_ledger`;--> statement-breakpoint
DROP TABLE `usage_ledger`;--> statement-breakpoint
ALTER TABLE `__new_usage_ledger` RENAME TO `usage_ledger`;--> statement-breakpoint
CREATE INDEX `usage_ledger_tenant_id_idx` ON `usage_ledger` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `usage_ledger_session_id_idx` ON `usage_ledger` (`session_id`);--> statement-breakpoint
CREATE INDEX `usage_ledger_run_id_idx` ON `usage_ledger` (`run_id`);--> statement-breakpoint
CREATE INDEX `usage_ledger_provider_model_idx` ON `usage_ledger` (`provider`,`model`);--> statement-breakpoint
CREATE INDEX `usage_ledger_tenant_created_at_idx` ON `usage_ledger` (`tenant_id`,`created_at`);--> statement-breakpoint
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
	FOREIGN KEY (`run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
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
CREATE INDEX `run_dependencies_timeout_at_idx` ON `run_dependencies` (`timeout_at`);--> statement-breakpoint
CREATE TABLE `__new_event_outbox` (
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` text NOT NULL,
	`created_at` text NOT NULL,
	`event_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`last_error` text,
	`processed_at` text,
	`status` text NOT NULL,
	`tenant_id` text,
	`topic` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `domain_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`,`tenant_id`) REFERENCES `domain_events`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_event_outbox`("attempts", "available_at", "created_at", "event_id", "id", "last_error", "processed_at", "status", "tenant_id", "topic") SELECT "attempts", "available_at", "created_at", "event_id", "id", "last_error", "processed_at", "status", "tenant_id", "topic" FROM `event_outbox`;--> statement-breakpoint
DROP TABLE `event_outbox`;--> statement-breakpoint
ALTER TABLE `__new_event_outbox` RENAME TO `event_outbox`;--> statement-breakpoint
CREATE INDEX `event_outbox_status_available_at_idx` ON `event_outbox` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `event_outbox_tenant_status_available_at_idx` ON `event_outbox` (`tenant_id`,`status`,`available_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_outbox_event_topic_unique` ON `event_outbox` (`event_id`,`topic`);--> statement-breakpoint
CREATE TABLE `__new_file_links` (
	`created_at` text NOT NULL,
	`file_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`link_type` text NOT NULL,
	`target_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`,`tenant_id`) REFERENCES `files`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_file_links`("created_at", "file_id", "id", "link_type", "target_id", "tenant_id") SELECT "created_at", "file_id", "id", "link_type", "target_id", "tenant_id" FROM `file_links`;--> statement-breakpoint
DROP TABLE `file_links`;--> statement-breakpoint
ALTER TABLE `__new_file_links` RENAME TO `file_links`;--> statement-breakpoint
CREATE UNIQUE INDEX `file_links_file_link_target_unique` ON `file_links` (`file_id`,`link_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `file_links_target_idx` ON `file_links` (`link_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `file_links_tenant_id_idx` ON `file_links` (`tenant_id`);
