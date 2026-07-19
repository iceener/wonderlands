CREATE TABLE `context_manifests` (
	`assembler_version` text NOT NULL,
	`created_at` text NOT NULL,
	`generated_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`manifest_json` text NOT NULL,
	`mode` text NOT NULL,
	`model` text NOT NULL,
	`provider` text NOT NULL,
	`replay_hash` text NOT NULL,
	`run_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`thread_id` text,
	`turn` integer NOT NULL,
	CONSTRAINT `context_manifests_turn_nonnegative` CHECK (`turn` >= 0),
	CONSTRAINT `context_manifests_mode_valid` CHECK (`mode` in ('shadow', 'active')),
	CONSTRAINT `context_manifests_manifest_json_valid` CHECK (json_valid(`manifest_json`)),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `context_manifests_run_tenant_fk` FOREIGN KEY (`run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `context_manifests_thread_tenant_fk` FOREIGN KEY (`thread_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `context_manifests_attempt_unique` ON `context_manifests` (`tenant_id`,`run_id`,`turn`,`mode`,`assembler_version`);--> statement-breakpoint
CREATE INDEX `context_manifests_tenant_run_idx` ON `context_manifests` (`tenant_id`,`run_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `context_manifests_tenant_thread_idx` ON `context_manifests` (`tenant_id`,`thread_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `context_manifests_tenant_created_at_idx` ON `context_manifests` (`tenant_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `context_manifests_created_at_idx` ON `context_manifests` (`created_at`);
