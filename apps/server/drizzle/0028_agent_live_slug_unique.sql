CREATE UNIQUE INDEX `agents_tenant_live_slug_unique`
ON `agents` (`tenant_id`, `slug`)
WHERE `status` <> 'deleted';--> statement-breakpoint
ALTER TABLE `agent_revisions` ADD `garden_focus_json` text NOT NULL DEFAULT '{}';--> statement-breakpoint
