PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE `__new_garden_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`source_scope_path` text NOT NULL,
	`build_mode` text NOT NULL,
	`deploy_mode` text NOT NULL,
	`protected_access_mode` text NOT NULL,
	`protected_secret_ref` text,
	`protected_session_ttl_seconds` integer NOT NULL,
	`current_build_id` text,
	`current_published_build_id` text,
	`created_by_account_id` text NOT NULL,
	`updated_by_account_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_garden_sites` (
	`id`,
	`tenant_id`,
	`slug`,
	`name`,
	`status`,
	`source_scope_path`,
	`build_mode`,
	`deploy_mode`,
	`protected_access_mode`,
	`protected_secret_ref`,
	`protected_session_ttl_seconds`,
	`current_build_id`,
	`current_published_build_id`,
	`created_by_account_id`,
	`updated_by_account_id`,
	`created_at`,
	`updated_at`,
	`is_default`
)
SELECT
	`id`,
	`tenant_id`,
	`slug`,
	`name`,
	`status`,
	`source_scope_path`,
	`build_mode`,
	`deploy_mode`,
	`protected_access_mode`,
	`protected_secret_ref`,
	`protected_session_ttl_seconds`,
	`current_build_id`,
	`current_published_build_id`,
	`created_by_account_id`,
	`updated_by_account_id`,
	`created_at`,
	`updated_at`,
	`is_default`
FROM `garden_sites`;
--> statement-breakpoint
DROP TABLE `garden_sites`;
--> statement-breakpoint
ALTER TABLE `__new_garden_sites` RENAME TO `garden_sites`;
--> statement-breakpoint
CREATE UNIQUE INDEX `garden_sites_slug_unique` ON `garden_sites` (`slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `garden_sites_tenant_slug_unique` ON `garden_sites` (`tenant_id`,`slug`);
--> statement-breakpoint
CREATE INDEX `garden_sites_tenant_status_idx` ON `garden_sites` (`tenant_id`,`status`);
--> statement-breakpoint
CREATE INDEX `garden_sites_current_build_id_idx` ON `garden_sites` (`current_build_id`);
--> statement-breakpoint
CREATE INDEX `garden_sites_current_published_build_id_idx` ON `garden_sites` (`current_published_build_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `garden_sites_default_unique` ON `garden_sites` (`is_default`) WHERE `is_default` = 1;
--> statement-breakpoint
PRAGMA foreign_keys = ON;
