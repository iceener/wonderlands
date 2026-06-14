PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_id_session_tenant_unique` ON `runs` (`id`,`session_id`,`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_session_messages` (
	`author_account_id` text,
	`author_kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`metadata` text,
	`run_id` text,
	`sequence` integer NOT NULL,
	`session_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`thread_id` text NOT NULL,
	FOREIGN KEY (`author_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `session_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`,`session_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`session_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`,`session_id`,`tenant_id`) REFERENCES `runs`(`id`,`session_id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_session_messages`("author_account_id", "author_kind", "content", "created_at", "id", "metadata", "run_id", "sequence", "session_id", "tenant_id", "thread_id") SELECT "author_account_id", "author_kind", "content", "created_at", "id", "metadata", "run_id", "sequence", "session_id", "tenant_id", "thread_id" FROM `session_messages`;--> statement-breakpoint
DROP TABLE `session_messages`;--> statement-breakpoint
ALTER TABLE `__new_session_messages` RENAME TO `session_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `session_messages_tenant_id_idx` ON `session_messages` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_messages_thread_sequence_unique` ON `session_messages` (`thread_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `session_messages_session_id_idx` ON `session_messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_messages_run_id_idx` ON `session_messages` (`run_id`);--> statement-breakpoint
CREATE TABLE `__new_session_threads` (
	`created_at` text NOT NULL,
	`created_by_account_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`parent_thread_id` text,
	`session_id` text NOT NULL,
	`status` text NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `work_sessions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_thread_id`,`session_id`,`tenant_id`) REFERENCES `session_threads`(`id`,`session_id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_session_threads`("created_at", "created_by_account_id", "id", "parent_thread_id", "session_id", "status", "tenant_id", "title", "updated_at") SELECT "created_at", "created_by_account_id", "id", "parent_thread_id", "session_id", "status", "tenant_id", "title", "updated_at" FROM `session_threads`;--> statement-breakpoint
DROP TABLE `session_threads`;--> statement-breakpoint
ALTER TABLE `__new_session_threads` RENAME TO `session_threads`;--> statement-breakpoint
CREATE UNIQUE INDEX `session_threads_id_tenant_unique` ON `session_threads` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_threads_id_session_tenant_unique` ON `session_threads` (`id`,`session_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `session_threads_tenant_id_idx` ON `session_threads` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `session_threads_session_id_idx` ON `session_threads` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_threads_parent_thread_id_idx` ON `session_threads` (`parent_thread_id`);--> statement-breakpoint
CREATE INDEX `session_threads_session_status_idx` ON `session_threads` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `work_sessions_root_run_id_idx` ON `work_sessions` (`root_run_id`);--> statement-breakpoint
CREATE TRIGGER `work_sessions_root_run_insert_guard`
BEFORE INSERT ON `work_sessions`
FOR EACH ROW
WHEN NEW.`root_run_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'work_sessions.root_run_id must be assigned after the root run exists');
END;--> statement-breakpoint
CREATE TRIGGER `work_sessions_root_run_update_guard`
BEFORE UPDATE OF `root_run_id`, `id`, `tenant_id` ON `work_sessions`
FOR EACH ROW
WHEN NEW.`root_run_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `runs`
    WHERE `id` = NEW.`root_run_id`
      AND `session_id` = NEW.`id`
      AND `tenant_id` = NEW.`tenant_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'work_sessions.root_run_id must reference a run in the same session and tenant');
END;
