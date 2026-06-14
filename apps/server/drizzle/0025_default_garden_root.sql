ALTER TABLE `garden_sites` ADD `is_default` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `garden_sites_default_unique` ON `garden_sites` (`is_default`) WHERE `is_default` = 1;
