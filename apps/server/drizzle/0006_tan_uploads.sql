ALTER TABLE `files` ADD `access_scope` text DEFAULT 'session_local' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `origin_upload_id` text;--> statement-breakpoint
CREATE INDEX `files_created_by_account_id_idx` ON `files` (`created_by_account_id`);--> statement-breakpoint
CREATE INDEX `files_tenant_access_scope_idx` ON `files` (`tenant_id`,`access_scope`);--> statement-breakpoint
CREATE INDEX `files_tenant_account_scope_idx` ON `files` (`tenant_id`,`created_by_account_id`,`access_scope`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`access_scope` text NOT NULL,
	`account_id` text,
	`checksum_sha256` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`declared_mime_type` text,
	`detected_mime_type` text,
	`error_text` text,
	`file_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`original_filename` text NOT NULL,
	`session_id` text,
	`size_bytes` integer,
	`staged_storage_key` text,
	`status` text NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_id_tenant_unique` ON `uploads` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `uploads_tenant_id_idx` ON `uploads` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `uploads_account_id_idx` ON `uploads` (`account_id`);--> statement-breakpoint
CREATE INDEX `uploads_session_id_idx` ON `uploads` (`session_id`);--> statement-breakpoint
CREATE INDEX `uploads_tenant_status_idx` ON `uploads` (`tenant_id`,`status`);
