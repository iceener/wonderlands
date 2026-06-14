CREATE TABLE `http_idempotency_keys` (
	`completed_at` text,
	`created_at` text NOT NULL,
	`expires_at` text,
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_data_json` text,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`status_code` integer,
	`tenant_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `http_idempotency_keys_tenant_scope_key_unique` ON `http_idempotency_keys` (`tenant_id`,`scope`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `http_idempotency_keys_status_expires_at_idx` ON `http_idempotency_keys` (`status`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `http_idempotency_keys_tenant_created_at_idx` ON `http_idempotency_keys` (`tenant_id`,`created_at`);
