CREATE TABLE `account_thread_activity_seen` (
	`account_id` text NOT NULL REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	`seen_completed_at` text NOT NULL,
	`seen_completed_run_id` text NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	`thread_id` text NOT NULL REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`thread_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`tenant_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seen_completed_run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_thread_activity_seen_tenant_account_thread_unique` ON `account_thread_activity_seen` (`tenant_id`,`account_id`,`thread_id`);
--> statement-breakpoint
CREATE INDEX `account_thread_activity_seen_tenant_account_idx` ON `account_thread_activity_seen` (`tenant_id`,`account_id`);
--> statement-breakpoint
CREATE INDEX `account_thread_activity_seen_thread_idx` ON `account_thread_activity_seen` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `account_thread_activity_seen_run_idx` ON `account_thread_activity_seen` (`seen_completed_run_id`);
