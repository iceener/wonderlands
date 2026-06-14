CREATE TABLE `auth_sessions` (
	`account_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`hashed_secret` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`last_used_at` text,
	`metadata_json` text,
	`revoked_at` text,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_account_id_idx` ON `auth_sessions` (`account_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_account_status_idx` ON `auth_sessions` (`account_id`,`status`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_at_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_hashed_secret_unique` ON `auth_sessions` (`hashed_secret`);
