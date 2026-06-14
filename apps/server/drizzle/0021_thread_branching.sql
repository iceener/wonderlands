ALTER TABLE `session_threads` ADD COLUMN `branch_from_message_id` text;
--> statement-breakpoint
ALTER TABLE `session_threads` ADD COLUMN `branch_from_sequence` integer;
--> statement-breakpoint
CREATE INDEX `session_threads_branch_from_message_id_idx` ON `session_threads` (`branch_from_message_id`);
