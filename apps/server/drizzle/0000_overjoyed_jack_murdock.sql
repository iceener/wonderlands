CREATE TABLE `accounts` (
	`created_at` text NOT NULL,
	`email` text,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`preferences` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_unique` ON `accounts` (`email`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`account_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	`hashed_secret` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`label` text,
	`last_four` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`scope_json` text,
	`status` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `api_keys_account_id_idx` ON `api_keys` (`account_id`);--> statement-breakpoint
CREATE INDEX `api_keys_account_status_idx` ON `api_keys` (`account_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hashed_secret_unique` ON `api_keys` (`hashed_secret`);--> statement-breakpoint
CREATE TABLE `tenant_memberships` (
	`account_id` text NOT NULL,
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`tenant_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_memberships_tenant_account_unique` ON `tenant_memberships` (`tenant_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `tenant_memberships_account_id_idx` ON `tenant_memberships` (`account_id`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE INDEX `tenants_status_idx` ON `tenants` (`status`);--> statement-breakpoint
CREATE TABLE `items` (
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `items_tenant_id_idx` ON `items` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_run_sequence_unique` ON `items` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `items_run_call_id_idx` ON `items` (`run_id`,`call_id`);--> statement-breakpoint
CREATE INDEX `items_call_id_idx` ON `items` (`call_id`);--> statement-breakpoint
CREATE TABLE `runs` (
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
	FOREIGN KEY (`thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `runs_tenant_id_idx` ON `runs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `runs_session_id_idx` ON `runs` (`session_id`);--> statement-breakpoint
CREATE INDEX `runs_thread_id_idx` ON `runs` (`thread_id`);--> statement-breakpoint
CREATE INDEX `runs_parent_run_id_idx` ON `runs` (`parent_run_id`);--> statement-breakpoint
CREATE INDEX `runs_root_run_id_idx` ON `runs` (`root_run_id`);--> statement-breakpoint
CREATE INDEX `runs_session_status_idx` ON `runs` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `runs_root_status_idx` ON `runs` (`root_run_id`,`status`);--> statement-breakpoint
CREATE INDEX `runs_status_progress_idx` ON `runs` (`status`,`last_progress_at`);--> statement-breakpoint
CREATE TABLE `session_messages` (
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
	FOREIGN KEY (`thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_messages_tenant_id_idx` ON `session_messages` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_messages_thread_sequence_unique` ON `session_messages` (`thread_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `session_messages_session_id_idx` ON `session_messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_messages_run_id_idx` ON `session_messages` (`run_id`);--> statement-breakpoint
CREATE TABLE `session_threads` (
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_threads_tenant_id_idx` ON `session_threads` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `session_threads_session_id_idx` ON `session_threads` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_threads_parent_thread_id_idx` ON `session_threads` (`parent_thread_id`);--> statement-breakpoint
CREATE INDEX `session_threads_session_status_idx` ON `session_threads` (`session_id`,`status`);--> statement-breakpoint
CREATE TABLE `tool_executions` (
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tool_executions_tenant_id_idx` ON `tool_executions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `tool_executions_run_id_idx` ON `tool_executions` (`run_id`);--> statement-breakpoint
CREATE INDEX `tool_executions_tool_idx` ON `tool_executions` (`tool`);--> statement-breakpoint
CREATE INDEX `tool_executions_run_tool_idx` ON `tool_executions` (`run_id`,`tool`);--> statement-breakpoint
CREATE INDEX `tool_executions_domain_idx` ON `tool_executions` (`domain`);--> statement-breakpoint
CREATE TABLE `usage_ledger` (
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
	`tenant_id` text NOT NULL,
	`thread_id` text,
	`tool_execution_id` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool_execution_id`) REFERENCES `tool_executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `usage_ledger_tenant_id_idx` ON `usage_ledger` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `usage_ledger_session_id_idx` ON `usage_ledger` (`session_id`);--> statement-breakpoint
CREATE INDEX `usage_ledger_run_id_idx` ON `usage_ledger` (`run_id`);--> statement-breakpoint
CREATE INDEX `usage_ledger_provider_model_idx` ON `usage_ledger` (`provider`,`model`);--> statement-breakpoint
CREATE INDEX `usage_ledger_tenant_created_at_idx` ON `usage_ledger` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `run_dependencies` (
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `run_dependencies_run_status_idx` ON `run_dependencies` (`run_id`,`status`);--> statement-breakpoint
CREATE INDEX `run_dependencies_target_run_id_idx` ON `run_dependencies` (`target_run_id`);--> statement-breakpoint
CREATE INDEX `run_dependencies_target_kind_ref_idx` ON `run_dependencies` (`target_kind`,`target_ref`);--> statement-breakpoint
CREATE INDEX `run_dependencies_run_call_id_idx` ON `run_dependencies` (`run_id`,`call_id`);--> statement-breakpoint
CREATE INDEX `run_dependencies_timeout_at_idx` ON `run_dependencies` (`timeout_at`);--> statement-breakpoint
CREATE TABLE `work_sessions` (
	`archived_at` text,
	`created_at` text NOT NULL,
	`created_by_account_id` text,
	`deleted_at` text,
	`id` text PRIMARY KEY NOT NULL,
	`metadata` text,
	`root_run_id` text,
	`status` text NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text,
	`updated_at` text NOT NULL,
	`workspace_ref` text,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `work_sessions_tenant_id_idx` ON `work_sessions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `work_sessions_tenant_status_idx` ON `work_sessions` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `work_sessions_created_by_account_id_idx` ON `work_sessions` (`created_by_account_id`);--> statement-breakpoint
CREATE TABLE `domain_events` (
	`actor_account_id` text,
	`aggregate_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`causation_id` text,
	`created_at` text NOT NULL,
	`event_no` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`tenant_id` text,
	`trace_id` text,
	`type` text NOT NULL,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_events_event_no_unique` ON `domain_events` (`event_no`);--> statement-breakpoint
CREATE INDEX `domain_events_aggregate_idx` ON `domain_events` (`aggregate_type`,`aggregate_id`);--> statement-breakpoint
CREATE INDEX `domain_events_tenant_event_no_idx` ON `domain_events` (`tenant_id`,`event_no`);--> statement-breakpoint
CREATE INDEX `domain_events_type_idx` ON `domain_events` (`type`);--> statement-breakpoint
CREATE TABLE `event_outbox` (
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_outbox_status_available_at_idx` ON `event_outbox` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `event_outbox_tenant_status_available_at_idx` ON `event_outbox` (`tenant_id`,`status`,`available_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_outbox_event_topic_unique` ON `event_outbox` (`event_id`,`topic`);