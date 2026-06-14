PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_memory_record_sources` (
	`created_at` text NOT NULL,
	`from_sequence` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`source_record_id` text,
	`source_run_id` text NOT NULL,
	`source_summary_id` text,
	`tenant_id` text NOT NULL,
	`through_sequence` integer NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_summary_id`) REFERENCES `context_summaries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`record_id`,`tenant_id`) REFERENCES `memory_records`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_record_id`,`tenant_id`) REFERENCES `memory_records`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_run_id`,`tenant_id`) REFERENCES `runs`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_summary_id`,`tenant_id`) REFERENCES `context_summaries`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_record_sources_sequence_rule" CHECK("__new_memory_record_sources"."from_sequence" <= "__new_memory_record_sources"."through_sequence")
);
--> statement-breakpoint
INSERT INTO `__new_memory_record_sources`("created_at", "from_sequence", "id", "record_id", "source_record_id", "source_run_id", "source_summary_id", "tenant_id", "through_sequence") SELECT "created_at", "from_sequence", "id", "record_id", NULL, "source_run_id", "source_summary_id", "tenant_id", "through_sequence" FROM `memory_record_sources`;--> statement-breakpoint
DROP TABLE `memory_record_sources`;--> statement-breakpoint
ALTER TABLE `__new_memory_record_sources` RENAME TO `memory_record_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `memory_record_sources_tenant_id_idx` ON `memory_record_sources` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `memory_record_sources_summary_id_idx` ON `memory_record_sources` (`source_summary_id`);--> statement-breakpoint
CREATE INDEX `memory_record_sources_record_id_idx` ON `memory_record_sources` (`record_id`);--> statement-breakpoint
CREATE INDEX `memory_record_sources_source_record_id_idx` ON `memory_record_sources` (`source_record_id`);
