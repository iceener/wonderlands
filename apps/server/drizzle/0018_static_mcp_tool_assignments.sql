PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mcp_tool_assignments` (
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mcp_tool_assignments_profile_not_blank" CHECK(length(trim("__new_mcp_tool_assignments"."profile")) > 0)
);--> statement-breakpoint
INSERT INTO `__new_mcp_tool_assignments`("approved_at", "approved_fingerprint", "assigned_at", "assigned_by_account_id", "id", "profile", "requires_confirmation", "runtime_name", "server_id", "tenant_id", "updated_at") SELECT "approved_at", "approved_fingerprint", "assigned_at", "assigned_by_account_id", "id", "profile", "requires_confirmation", "runtime_name", "server_id", "tenant_id", "updated_at" FROM `mcp_tool_assignments`;--> statement-breakpoint
DROP TABLE `mcp_tool_assignments`;--> statement-breakpoint
ALTER TABLE `__new_mcp_tool_assignments` RENAME TO `mcp_tool_assignments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_assignments_id_tenant_unique` ON `mcp_tool_assignments` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_assignments_scope_runtime_unique` ON `mcp_tool_assignments` (`tenant_id`,`assigned_by_account_id`,`profile`,`runtime_name`);--> statement-breakpoint
CREATE INDEX `mcp_tool_assignments_tenant_id_idx` ON `mcp_tool_assignments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `mcp_tool_assignments_scope_idx` ON `mcp_tool_assignments` (`tenant_id`,`assigned_by_account_id`,`profile`);--> statement-breakpoint
CREATE INDEX `mcp_tool_assignments_runtime_name_idx` ON `mcp_tool_assignments` (`runtime_name`);
