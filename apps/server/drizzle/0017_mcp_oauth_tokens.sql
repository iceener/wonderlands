CREATE TABLE `mcp_oauth_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_id` text NOT NULL,
	`server_id` text NOT NULL,
	`client_information_json` text,
	`discovery_state_json` text,
	`tokens_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_credentials_tenant_account_server_unique` ON `mcp_oauth_credentials` (`tenant_id`,`account_id`,`server_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_credentials_tenant_account_idx` ON `mcp_oauth_credentials` (`tenant_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_credentials_server_idx` ON `mcp_oauth_credentials` (`server_id`);--> statement-breakpoint
CREATE TABLE `mcp_oauth_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_id` text NOT NULL,
	`server_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`response_origin` text,
	`code_verifier_secret_json` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `mcp_oauth_authorizations_tenant_account_server_idx` ON `mcp_oauth_authorizations` (`tenant_id`,`account_id`,`server_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_authorizations_expires_idx` ON `mcp_oauth_authorizations` (`expires_at`);
