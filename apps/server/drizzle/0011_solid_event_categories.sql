ALTER TABLE `domain_events` ADD `category` text NOT NULL DEFAULT 'domain';
--> statement-breakpoint
UPDATE `domain_events`
SET `category` = 'telemetry'
WHERE `type` IN (
  'generation.completed',
  'progress.reported',
  'stream.delta',
  'stream.done',
  'turn.completed',
  'turn.started'
);
--> statement-breakpoint
CREATE INDEX `domain_events_tenant_category_event_no_idx` ON `domain_events` (`tenant_id`,`category`,`event_no`);
