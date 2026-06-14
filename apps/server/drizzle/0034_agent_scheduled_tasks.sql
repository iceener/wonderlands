CREATE TABLE `agent_scheduled_tasks` (
	`agent_id` text NOT NULL,
	`archived_at` text,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_account_id` text NOT NULL,
	`cron_expression` text NOT NULL,
	`deleted_at` text,
	`description` text,
	`id` text PRIMARY KEY NOT NULL,
	`last_attempt_id` text,
	`last_error_json` text,
	`last_job_id` text,
	`last_message_id` text,
	`last_run_at` text,
	`last_run_id` text,
	`last_session_id` text,
	`last_thread_id` text,
	`name` text NOT NULL,
	`next_run_at` text,
	`overlap_policy` text NOT NULL,
	`owner_account_id` text NOT NULL,
	`paused_at` text,
	`status` text NOT NULL,
	`tenant_id` text NOT NULL,
	`timezone` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_account_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `agent_scheduled_tasks_tenant_owner_status_idx` ON `agent_scheduled_tasks` (`tenant_id`,`owner_account_id`,`status`);--> statement-breakpoint
CREATE INDEX `agent_scheduled_tasks_status_next_run_idx` ON `agent_scheduled_tasks` (`status`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `agent_scheduled_tasks_tenant_agent_idx` ON `agent_scheduled_tasks` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_scheduled_tasks_tenant_owner_idx` ON `agent_scheduled_tasks` (`tenant_id`,`owner_account_id`);--> statement-breakpoint
CREATE INDEX `agent_scheduled_tasks_last_thread_idx` ON `agent_scheduled_tasks` (`last_thread_id`);--> statement-breakpoint
CREATE TABLE `agent_scheduled_task_runs` (
	`bootstrap_completed_at` text,
	`bootstrap_started_at` text,
	`claimed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`error_json` text,
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`job_id` text,
	`message_id` text,
	`run_id` text,
	`scheduled_for` text NOT NULL,
	`session_id` text,
	`status` text NOT NULL,
	`task_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`terminal_at` text,
	`thread_id` text,
	`trigger` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `agent_scheduled_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_scheduled_task_runs_task_idempotency_unique` ON `agent_scheduled_task_runs` (`task_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_scheduled_task_runs_tenant_task_created_idx` ON `agent_scheduled_task_runs` (`tenant_id`,`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_scheduled_task_runs_status_claimed_idx` ON `agent_scheduled_task_runs` (`status`,`claimed_at`);--> statement-breakpoint
CREATE INDEX `agent_scheduled_task_runs_thread_idx` ON `agent_scheduled_task_runs` (`thread_id`);--> statement-breakpoint
CREATE INDEX `agent_scheduled_task_runs_run_idx` ON `agent_scheduled_task_runs` (`run_id`);
