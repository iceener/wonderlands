CREATE TABLE `mcp_servers` (
	`config_json` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_account_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`last_discovered_at` text,
	`last_error` text,
	`log_level` text,
	`tenant_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_id_tenant_unique` ON `mcp_servers` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_tenant_account_label_unique` ON `mcp_servers` (`tenant_id`,`created_by_account_id`,`label`);--> statement-breakpoint
CREATE INDEX `mcp_servers_tenant_id_idx` ON `mcp_servers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `mcp_servers_tenant_account_idx` ON `mcp_servers` (`tenant_id`,`created_by_account_id`);--> statement-breakpoint
CREATE INDEX `mcp_servers_tenant_enabled_idx` ON `mcp_servers` (`tenant_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `mcp_tool_assignments` (
	`approved_at` text,
	`approved_fingerprint` text,
	`assigned_at` text NOT NULL,
	`assigned_by_account_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`profile` text NOT NULL,
	`requires_confirmation` integer DEFAULT true NOT NULL,
	`runtime_name` text NOT NULL,
	`server_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assigned_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`server_id`,`tenant_id`) REFERENCES `mcp_servers`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`runtime_name`,`tenant_id`) REFERENCES `mcp_tool_cache`(`runtime_name`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mcp_tool_assignments_profile_not_blank" CHECK(length(trim("mcp_tool_assignments"."profile")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_assignments_id_tenant_unique` ON `mcp_tool_assignments` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_assignments_scope_runtime_unique` ON `mcp_tool_assignments` (`tenant_id`,`assigned_by_account_id`,`profile`,`runtime_name`);--> statement-breakpoint
CREATE INDEX `mcp_tool_assignments_tenant_id_idx` ON `mcp_tool_assignments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `mcp_tool_assignments_scope_idx` ON `mcp_tool_assignments` (`tenant_id`,`assigned_by_account_id`,`profile`);--> statement-breakpoint
CREATE INDEX `mcp_tool_assignments_runtime_name_idx` ON `mcp_tool_assignments` (`runtime_name`);--> statement-breakpoint
CREATE TABLE `mcp_tool_cache` (
	`apps_meta_json` text,
	`created_at` text NOT NULL,
	`description` text,
	`execution_json` text,
	`fingerprint` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`input_schema_json` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`model_visible` integer DEFAULT true NOT NULL,
	`output_schema_json` text,
	`remote_name` text NOT NULL,
	`runtime_name` text NOT NULL,
	`server_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`server_id`,`tenant_id`) REFERENCES `mcp_servers`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_cache_id_tenant_unique` ON `mcp_tool_cache` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_cache_server_remote_unique` ON `mcp_tool_cache` (`server_id`,`remote_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_cache_tenant_runtime_unique` ON `mcp_tool_cache` (`tenant_id`,`runtime_name`);--> statement-breakpoint
CREATE INDEX `mcp_tool_cache_tenant_id_idx` ON `mcp_tool_cache` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `mcp_tool_cache_server_id_idx` ON `mcp_tool_cache` (`server_id`);--> statement-breakpoint
CREATE INDEX `mcp_tool_cache_server_active_idx` ON `mcp_tool_cache` (`server_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `mcp_tool_cache_runtime_name_idx` ON `mcp_tool_cache` (`runtime_name`);--> statement-breakpoint
CREATE INDEX `mcp_tool_cache_fingerprint_idx` ON `mcp_tool_cache` (`fingerprint`);