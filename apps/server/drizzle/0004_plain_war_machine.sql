CREATE TABLE `memory_record_sources` (
	`created_at` text NOT NULL,
	`from_sequence` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`source_run_id` text NOT NULL,
	`source_summary_id` text,
	`tenant_id` text NOT NULL,
	`through_sequence` integer NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_summary_id`) REFERENCES `context_summaries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`record_id`,`tenant_id`) REFERENCES `memory_records`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_summary_id`,`tenant_id`) REFERENCES `context_summaries`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_record_sources_sequence_rule" CHECK("memory_record_sources"."from_sequence" <= "memory_record_sources"."through_sequence")
);
--> statement-breakpoint
CREATE INDEX `memory_record_sources_tenant_id_idx` ON `memory_record_sources` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `memory_record_sources_summary_id_idx` ON `memory_record_sources` (`source_summary_id`);--> statement-breakpoint
CREATE INDEX `memory_record_sources_record_id_idx` ON `memory_record_sources` (`record_id`);--> statement-breakpoint
CREATE TABLE `memory_records` (
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner_run_id` text,
	`parent_record_id` text,
	`root_run_id` text,
	`scope_kind` text NOT NULL,
	`scope_ref` text NOT NULL,
	`session_id` text,
	`status` text NOT NULL,
	`tenant_id` text NOT NULL,
	`thread_id` text,
	`token_count` integer,
	`visibility` text NOT NULL,
	FOREIGN KEY (`owner_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_record_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`root_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`root_run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_records_id_tenant_unique` ON `memory_records` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `memory_records_tenant_id_idx` ON `memory_records` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `memory_records_scope_idx` ON `memory_records` (`scope_kind`,`scope_ref`);--> statement-breakpoint
CREATE INDEX `memory_records_owner_run_idx` ON `memory_records` (`owner_run_id`);--> statement-breakpoint
CREATE INDEX `memory_records_kind_status_idx` ON `memory_records` (`kind`,`status`);