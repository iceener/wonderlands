CREATE TABLE `garden_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`source_account_id` text NOT NULL,
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `garden_sites_tenant_slug_unique` ON `garden_sites` (`tenant_id`,`slug`);
--> statement-breakpoint
CREATE INDEX `garden_sites_tenant_status_idx` ON `garden_sites` (`tenant_id`,`status`);
--> statement-breakpoint
CREATE INDEX `garden_sites_source_account_id_idx` ON `garden_sites` (`source_account_id`);
--> statement-breakpoint
CREATE INDEX `garden_sites_current_build_id_idx` ON `garden_sites` (`current_build_id`);
--> statement-breakpoint
CREATE INDEX `garden_sites_current_published_build_id_idx` ON `garden_sites` (`current_published_build_id`);
--> statement-breakpoint
CREATE TABLE `garden_builds` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`requested_by_account_id` text NOT NULL,
	`trigger_kind` text NOT NULL,
	`status` text NOT NULL,
	`source_fingerprint_sha256` text,
	`config_fingerprint_sha256` text,
	`public_artifact_root` text,
	`protected_artifact_root` text,
	`manifest_json` text,
	`public_page_count` integer DEFAULT 0 NOT NULL,
	`protected_page_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `garden_sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `garden_builds_site_id_idx` ON `garden_builds` (`site_id`);
--> statement-breakpoint
CREATE INDEX `garden_builds_tenant_site_created_idx` ON `garden_builds` (`tenant_id`,`site_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `garden_builds_status_idx` ON `garden_builds` (`status`);
--> statement-breakpoint
CREATE TABLE `garden_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`build_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`status` text NOT NULL,
	`config_json` text,
	`external_url` text,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `garden_sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`build_id`) REFERENCES `garden_builds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `garden_deployments_build_id_idx` ON `garden_deployments` (`build_id`);
--> statement-breakpoint
CREATE INDEX `garden_deployments_site_id_idx` ON `garden_deployments` (`site_id`);
--> statement-breakpoint
CREATE INDEX `garden_deployments_status_idx` ON `garden_deployments` (`status`);
