CREATE TABLE `account_agent_defaults` (
	`account_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`,`tenant_id`) REFERENCES `agents`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_agent_defaults_tenant_account_unique` ON `account_agent_defaults` (`tenant_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `account_agent_defaults_agent_id_idx` ON `account_agent_defaults` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_revisions` (
	`agent_id` text NOT NULL,
	`checksum_sha256` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_account_id` text,
	`frontmatter_json` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`instructions_md` text NOT NULL,
	`memory_policy_json` text NOT NULL,
	`model_config_json` text NOT NULL,
	`resolved_config_json` text NOT NULL,
	`source_markdown` text NOT NULL,
	`tenant_id` text NOT NULL,
	`tool_policy_json` text NOT NULL,
	`version` integer NOT NULL,
	`workspace_policy_json` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`,`tenant_id`) REFERENCES `agents`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_revisions_id_tenant_unique` ON `agent_revisions` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_revisions_id_agent_tenant_unique` ON `agent_revisions` (`id`,`agent_id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_revisions_agent_version_unique` ON `agent_revisions` (`agent_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_revisions_agent_checksum_unique` ON `agent_revisions` (`agent_id`,`checksum_sha256`);--> statement-breakpoint
CREATE INDEX `agent_revisions_tenant_id_idx` ON `agent_revisions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `agent_revisions_agent_id_idx` ON `agent_revisions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_revisions_created_by_account_id_idx` ON `agent_revisions` (`created_by_account_id`);--> statement-breakpoint
CREATE TABLE `agent_subagent_links` (
	`alias` text NOT NULL,
	`child_agent_id` text NOT NULL,
	`created_at` text NOT NULL,
	`delegation_mode` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`parent_agent_revision_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`tenant_id` text NOT NULL,
	FOREIGN KEY (`child_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_agent_revision_id`) REFERENCES `agent_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_agent_revision_id`,`tenant_id`) REFERENCES `agent_revisions`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_agent_id`,`tenant_id`) REFERENCES `agents`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_subagent_links_parent_alias_unique` ON `agent_subagent_links` (`parent_agent_revision_id`,`alias`);--> statement-breakpoint
CREATE INDEX `agent_subagent_links_parent_position_idx` ON `agent_subagent_links` (`parent_agent_revision_id`,`position`);--> statement-breakpoint
CREATE INDEX `agent_subagent_links_child_agent_id_idx` ON `agent_subagent_links` (`child_agent_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`active_revision_id` text,
	`archived_at` text,
	`base_agent_id` text,
	`created_at` text NOT NULL,
	`created_by_account_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`owner_account_id` text,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`tenant_id` text NOT NULL,
	`updated_at` text NOT NULL,
	`visibility` text NOT NULL,
	FOREIGN KEY (`base_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agents_system_owner_rule" CHECK(("agents"."visibility" <> 'system' or "agents"."owner_account_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_id_tenant_unique` ON `agents` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `agents_tenant_visibility_status_idx` ON `agents` (`tenant_id`,`visibility`,`status`);--> statement-breakpoint
CREATE INDEX `agents_tenant_slug_idx` ON `agents` (`tenant_id`,`slug`);--> statement-breakpoint
CREATE INDEX `agents_owner_account_id_idx` ON `agents` (`owner_account_id`);--> statement-breakpoint
CREATE INDEX `agents_active_revision_id_idx` ON `agents` (`active_revision_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`account_id` text NOT NULL,
	`created_at` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`root_ref` text NOT NULL,
	`status` text NOT NULL,
	`tenant_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_id_tenant_unique` ON `workspaces` (`id`,`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_tenant_account_kind_unique` ON `workspaces` (`tenant_id`,`account_id`,`kind`);--> statement-breakpoint
CREATE INDEX `workspaces_tenant_status_idx` ON `workspaces` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `workspaces_account_id_idx` ON `workspaces` (`account_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `agent_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `agent_revision_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `workspace_id` text;--> statement-breakpoint
CREATE INDEX `runs_agent_id_idx` ON `runs` (`agent_id`);--> statement-breakpoint
CREATE INDEX `runs_agent_revision_id_idx` ON `runs` (`agent_revision_id`);--> statement-breakpoint
CREATE INDEX `runs_workspace_id_idx` ON `runs` (`workspace_id`);--> statement-breakpoint
CREATE TRIGGER `runs_agent_binding_insert_guard`
BEFORE INSERT ON `runs`
FOR EACH ROW
WHEN (
  (NEW.`agent_id` IS NULL AND NEW.`agent_revision_id` IS NOT NULL) OR
  (NEW.`agent_id` IS NOT NULL AND NEW.`agent_revision_id` IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'runs.agent_id and runs.agent_revision_id must be assigned together');
END;--> statement-breakpoint
CREATE TRIGGER `runs_agent_binding_update_guard`
BEFORE UPDATE OF `agent_id`, `agent_revision_id` ON `runs`
FOR EACH ROW
WHEN (
  (NEW.`agent_id` IS NULL AND NEW.`agent_revision_id` IS NOT NULL) OR
  (NEW.`agent_id` IS NOT NULL AND NEW.`agent_revision_id` IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'runs.agent_id and runs.agent_revision_id must be assigned together');
END;--> statement-breakpoint
CREATE TRIGGER `runs_parent_scope_insert_guard`
BEFORE INSERT ON `runs`
FOR EACH ROW
WHEN NEW.`parent_run_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `runs`
    WHERE `id` = NEW.`parent_run_id`
      AND `session_id` = NEW.`session_id`
      AND `tenant_id` = NEW.`tenant_id`
      AND `root_run_id` = NEW.`root_run_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'runs.parent_run_id must reference a run in the same session, root run, and tenant');
END;--> statement-breakpoint
CREATE TRIGGER `runs_parent_scope_update_guard`
BEFORE UPDATE OF `parent_run_id`, `session_id`, `tenant_id`, `root_run_id` ON `runs`
FOR EACH ROW
WHEN NEW.`parent_run_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `runs`
    WHERE `id` = NEW.`parent_run_id`
      AND `session_id` = NEW.`session_id`
      AND `tenant_id` = NEW.`tenant_id`
      AND `root_run_id` = NEW.`root_run_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'runs.parent_run_id must reference a run in the same session, root run, and tenant');
END;--> statement-breakpoint
CREATE TRIGGER `runs_agent_revision_insert_guard`
BEFORE INSERT ON `runs`
FOR EACH ROW
WHEN NEW.`agent_id` IS NOT NULL
  AND NEW.`agent_revision_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `agent_revisions`
    WHERE `id` = NEW.`agent_revision_id`
      AND `agent_id` = NEW.`agent_id`
      AND `tenant_id` = NEW.`tenant_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'runs.agent_revision_id must reference an agent revision in the same tenant');
END;--> statement-breakpoint
CREATE TRIGGER `runs_agent_revision_update_guard`
BEFORE UPDATE OF `agent_id`, `agent_revision_id`, `tenant_id` ON `runs`
FOR EACH ROW
WHEN NEW.`agent_id` IS NOT NULL
  AND NEW.`agent_revision_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `agent_revisions`
    WHERE `id` = NEW.`agent_revision_id`
      AND `agent_id` = NEW.`agent_id`
      AND `tenant_id` = NEW.`tenant_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'runs.agent_revision_id must reference an agent revision in the same tenant');
END;--> statement-breakpoint
ALTER TABLE `work_sessions` ADD COLUMN `workspace_id` text;--> statement-breakpoint
CREATE INDEX `work_sessions_workspace_id_idx` ON `work_sessions` (`workspace_id`);--> statement-breakpoint
CREATE TRIGGER `runs_workspace_insert_guard`
BEFORE INSERT ON `runs`
FOR EACH ROW
WHEN NEW.`workspace_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `workspaces`
    WHERE `id` = NEW.`workspace_id`
      AND `tenant_id` = NEW.`tenant_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'runs.workspace_id must reference a workspace in the same tenant');
END;--> statement-breakpoint
CREATE TRIGGER `runs_workspace_update_guard`
BEFORE UPDATE OF `workspace_id`, `tenant_id` ON `runs`
FOR EACH ROW
WHEN NEW.`workspace_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `workspaces`
    WHERE `id` = NEW.`workspace_id`
      AND `tenant_id` = NEW.`tenant_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'runs.workspace_id must reference a workspace in the same tenant');
END;--> statement-breakpoint
CREATE TRIGGER `work_sessions_workspace_insert_guard`
BEFORE INSERT ON `work_sessions`
FOR EACH ROW
WHEN NEW.`workspace_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `workspaces`
    WHERE `id` = NEW.`workspace_id`
      AND `tenant_id` = NEW.`tenant_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'work_sessions.workspace_id must reference a workspace in the same tenant');
END;--> statement-breakpoint
CREATE TRIGGER `work_sessions_workspace_update_guard`
BEFORE UPDATE OF `workspace_id`, `tenant_id` ON `work_sessions`
FOR EACH ROW
WHEN NEW.`workspace_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `workspaces`
    WHERE `id` = NEW.`workspace_id`
      AND `tenant_id` = NEW.`tenant_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'work_sessions.workspace_id must reference a workspace in the same tenant');
END;
