CREATE TABLE `tool_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `account_id` text REFERENCES `accounts`(`id`),
  `name` text NOT NULL,
  `scope` text NOT NULL,
  `status` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_profiles_id_tenant_unique` ON `tool_profiles` (`id`,`tenant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_profiles_tenant_scope_name_unique` ON `tool_profiles` (`tenant_id`,`scope`,`name`);
--> statement-breakpoint
CREATE INDEX `tool_profiles_tenant_scope_idx` ON `tool_profiles` (`tenant_id`,`scope`);
--> statement-breakpoint
CREATE INDEX `tool_profiles_account_id_idx` ON `tool_profiles` (`account_id`);
--> statement-breakpoint
CREATE TABLE `account_preferences` (
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `account_id` text NOT NULL REFERENCES `accounts`(`id`),
  `assistant_tool_profile_id` text NOT NULL,
  `default_target_kind` text NOT NULL,
  `default_agent_id` text,
  `shortcut_bindings` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_preferences_tenant_account_unique` ON `account_preferences` (`tenant_id`,`account_id`);
--> statement-breakpoint
CREATE INDEX `account_preferences_default_agent_id_idx` ON `account_preferences` (`default_agent_id`);
--> statement-breakpoint
CREATE INDEX `account_preferences_assistant_tool_profile_id_idx` ON `account_preferences` (`assistant_tool_profile_id`);
--> statement-breakpoint
ALTER TABLE `agent_revisions` ADD COLUMN `tool_profile_id` text;
--> statement-breakpoint
CREATE INDEX `agent_revisions_tool_profile_id_idx` ON `agent_revisions` (`tool_profile_id`);
--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD COLUMN `scope` text NOT NULL DEFAULT 'account_private';
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_mcp_tool_assignments` (
  `approved_at` text,
  `approved_fingerprint` text,
  `created_at` text NOT NULL,
  `id` text PRIMARY KEY NOT NULL,
  `requires_confirmation` integer DEFAULT true NOT NULL,
  `runtime_name` text NOT NULL,
  `server_id` text NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `tool_profile_id` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mcp_tool_assignments`(
  `approved_at`,
  `approved_fingerprint`,
  `created_at`,
  `id`,
  `requires_confirmation`,
  `runtime_name`,
  `server_id`,
  `tenant_id`,
  `tool_profile_id`,
  `updated_at`
)
SELECT
  `approved_at`,
  `approved_fingerprint`,
  CASE
    WHEN `assigned_at` IS NOT NULL AND `assigned_at` <> '' THEN `assigned_at`
    ELSE `updated_at`
  END,
  `id`,
  `requires_confirmation`,
  `runtime_name`,
  `server_id`,
  `tenant_id`,
  `profile`,
  `updated_at`
FROM `mcp_tool_assignments`;
--> statement-breakpoint
DROP TABLE `mcp_tool_assignments`;
--> statement-breakpoint
ALTER TABLE `__new_mcp_tool_assignments` RENAME TO `mcp_tool_assignments`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_assignments_id_tenant_unique` ON `mcp_tool_assignments` (`id`,`tenant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_assignments_scope_runtime_unique` ON `mcp_tool_assignments` (`tenant_id`,`tool_profile_id`,`runtime_name`);
--> statement-breakpoint
CREATE INDEX `mcp_tool_assignments_tenant_id_idx` ON `mcp_tool_assignments` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `mcp_tool_assignments_tool_profile_idx` ON `mcp_tool_assignments` (`tenant_id`,`tool_profile_id`);
--> statement-breakpoint
CREATE INDEX `mcp_tool_assignments_runtime_name_idx` ON `mcp_tool_assignments` (`runtime_name`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `work_sessions_root_run_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `work_sessions_root_run_update_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `runs_agent_binding_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `runs_agent_binding_update_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `runs_parent_scope_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `runs_parent_scope_update_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `runs_agent_revision_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `runs_agent_revision_update_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `runs_workspace_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `runs_workspace_update_guard`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_runs` (
  `actor_account_id` text REFERENCES `accounts`(`id`),
  `completed_at` text,
  `config_snapshot` text NOT NULL,
  `created_at` text NOT NULL,
  `error_json` text,
  `agent_id` text,
  `agent_revision_id` text,
  `id` text PRIMARY KEY NOT NULL,
  `last_progress_at` text,
  `parent_run_id` text REFERENCES `runs`(`id`),
  `result_json` text,
  `root_run_id` text NOT NULL,
  `session_id` text NOT NULL REFERENCES `work_sessions`(`id`),
  `source_call_id` text,
  `started_at` text,
  `status` text NOT NULL,
  `task` text NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `target_kind` text NOT NULL,
  `thread_id` text REFERENCES `session_threads`(`id`),
  `tool_profile_id` text,
  `turn_count` integer DEFAULT 0 NOT NULL,
  `updated_at` text NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `job_id` text,
  `workspace_id` text,
  `workspace_ref` text,
  CONSTRAINT "runs_root_run_rule" CHECK((("__new_runs"."parent_run_id" is null and "__new_runs"."root_run_id" = "__new_runs"."id") or ("__new_runs"."parent_run_id" is not null and "__new_runs"."root_run_id" <> "__new_runs"."id")))
);
--> statement-breakpoint
INSERT INTO `__new_runs`(
  `actor_account_id`,
  `completed_at`,
  `config_snapshot`,
  `created_at`,
  `error_json`,
  `agent_id`,
  `agent_revision_id`,
  `id`,
  `last_progress_at`,
  `parent_run_id`,
  `result_json`,
  `root_run_id`,
  `session_id`,
  `source_call_id`,
  `started_at`,
  `status`,
  `task`,
  `tenant_id`,
  `target_kind`,
  `thread_id`,
  `tool_profile_id`,
  `turn_count`,
  `updated_at`,
  `version`,
  `job_id`,
  `workspace_id`,
  `workspace_ref`
)
SELECT
  NULL,
  `completed_at`,
  `config_snapshot`,
  `created_at`,
  `error_json`,
  `agent_id`,
  `agent_revision_id`,
  `id`,
  `last_progress_at`,
  `parent_run_id`,
  `result_json`,
  `root_run_id`,
  `session_id`,
  `source_call_id`,
  `started_at`,
  `status`,
  `task`,
  `tenant_id`,
  CASE
    WHEN `agent_id` IS NOT NULL THEN 'agent'
    ELSE 'assistant'
  END,
  `thread_id`,
  `profile`,
  `turn_count`,
  `updated_at`,
  `version`,
  `job_id`,
  `workspace_id`,
  `workspace_ref`
FROM `runs`;
--> statement-breakpoint
DROP TABLE `runs`;
--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_id_tenant_unique` ON `runs` (`id`,`tenant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_id_session_tenant_unique` ON `runs` (`id`,`session_id`,`tenant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_id_tenant_session_root_unique` ON `runs` (`id`,`tenant_id`,`session_id`,`root_run_id`);
--> statement-breakpoint
CREATE INDEX `runs_tenant_id_idx` ON `runs` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `runs_session_id_idx` ON `runs` (`session_id`);
--> statement-breakpoint
CREATE INDEX `runs_thread_id_idx` ON `runs` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `runs_parent_run_id_idx` ON `runs` (`parent_run_id`);
--> statement-breakpoint
CREATE INDEX `runs_root_run_id_idx` ON `runs` (`root_run_id`);
--> statement-breakpoint
CREATE INDEX `runs_agent_id_idx` ON `runs` (`agent_id`);
--> statement-breakpoint
CREATE INDEX `runs_agent_revision_id_idx` ON `runs` (`agent_revision_id`);
--> statement-breakpoint
CREATE INDEX `runs_actor_account_id_idx` ON `runs` (`actor_account_id`);
--> statement-breakpoint
CREATE INDEX `runs_target_kind_idx` ON `runs` (`target_kind`);
--> statement-breakpoint
CREATE INDEX `runs_tool_profile_id_idx` ON `runs` (`tool_profile_id`);
--> statement-breakpoint
CREATE INDEX `runs_workspace_id_idx` ON `runs` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `runs_job_id_idx` ON `runs` (`job_id`);
--> statement-breakpoint
CREATE INDEX `runs_session_status_idx` ON `runs` (`session_id`,`status`);
--> statement-breakpoint
CREATE INDEX `runs_root_status_idx` ON `runs` (`root_run_id`,`status`);
--> statement-breakpoint
CREATE INDEX `runs_status_progress_idx` ON `runs` (`status`,`last_progress_at`);
--> statement-breakpoint
CREATE TRIGGER `work_sessions_root_run_insert_guard`
BEFORE INSERT ON `work_sessions`
FOR EACH ROW
WHEN NEW.`root_run_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'work_sessions.root_run_id must be assigned after the root run exists');
END;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER `runs_agent_binding_insert_guard`
BEFORE INSERT ON `runs`
FOR EACH ROW
WHEN (
  (NEW.`agent_id` IS NULL AND NEW.`agent_revision_id` IS NOT NULL) OR
  (NEW.`agent_id` IS NOT NULL AND NEW.`agent_revision_id` IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'runs.agent_id and runs.agent_revision_id must be assigned together');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_agent_binding_update_guard`
BEFORE UPDATE OF `agent_id`, `agent_revision_id` ON `runs`
FOR EACH ROW
WHEN (
  (NEW.`agent_id` IS NULL AND NEW.`agent_revision_id` IS NOT NULL) OR
  (NEW.`agent_id` IS NOT NULL AND NEW.`agent_revision_id` IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'runs.agent_id and runs.agent_revision_id must be assigned together');
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
END;
