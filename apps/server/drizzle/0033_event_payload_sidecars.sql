CREATE TABLE `event_payload_sidecars` (
	`created_at` text NOT NULL,
	`encoding` text NOT NULL,
	`event_id` text PRIMARY KEY NOT NULL,
	`payload_compressed` blob NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `domain_events`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `event_payload_sidecars_created_at_idx` ON `event_payload_sidecars` (`created_at`);
