CREATE TABLE `jobs` (
	`assigned_agent_id` text,
	`assigned_agent_revision_id` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`current_run_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`input_json` text,
	`kind` text NOT NULL,
	`last_heartbeat_at` text,
	`last_scheduler_sync_at` text,
	`next_scheduler_check_at` text,
	`parent_job_id` text,
	`priority` integer DEFAULT 100 NOT NULL,
	`queued_at` text,
	`result_json` text,
	`root_job_id` text NOT NULL,
	`session_id` text NOT NULL,
	`status_reason_json` text,
	`status` text NOT NULL,
	`tenant_id` text NOT NULL,
	`thread_id` text,
	`title` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`,`session_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`session_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_job_id`,`tenant_id`) REFERENCES `jobs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`root_job_id`,`tenant_id`) REFERENCES `jobs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_agent_id`,`tenant_id`) REFERENCES `agents`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_id_tenant_unique` ON `jobs` (`id`,`tenant_id`);
--> statement-breakpoint
CREATE INDEX `jobs_tenant_id_idx` ON `jobs` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `jobs_session_id_idx` ON `jobs` (`session_id`);
--> statement-breakpoint
CREATE INDEX `jobs_thread_id_idx` ON `jobs` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `jobs_parent_job_id_idx` ON `jobs` (`parent_job_id`);
--> statement-breakpoint
CREATE INDEX `jobs_root_job_id_idx` ON `jobs` (`root_job_id`);
--> statement-breakpoint
CREATE INDEX `jobs_current_run_id_idx` ON `jobs` (`current_run_id`);
--> statement-breakpoint
CREATE INDEX `jobs_status_priority_idx` ON `jobs` (`session_id`,`status`,`priority`);
--> statement-breakpoint
CREATE INDEX `jobs_queued_at_idx` ON `jobs` (`queued_at`);
--> statement-breakpoint
CREATE TABLE `job_dependencies` (
	`created_at` text NOT NULL,
	`from_job_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`metadata_json` text,
	`session_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`to_job_id` text NOT NULL,
	`type` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_job_id`,`tenant_id`) REFERENCES `jobs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_job_id`,`tenant_id`) REFERENCES `jobs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_dependencies_relation_unique` ON `job_dependencies` (`from_job_id`,`to_job_id`,`type`);
--> statement-breakpoint
CREATE INDEX `job_dependencies_to_job_id_idx` ON `job_dependencies` (`to_job_id`);
--> statement-breakpoint
CREATE INDEX `job_dependencies_session_type_idx` ON `job_dependencies` (`session_id`,`type`);
--> statement-breakpoint
ALTER TABLE `runs` ADD `job_id` text;
--> statement-breakpoint
CREATE INDEX `runs_job_id_idx` ON `runs` (`job_id`);
