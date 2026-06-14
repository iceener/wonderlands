CREATE TABLE `password_credentials` (
  `account_id` text PRIMARY KEY NOT NULL,
  `created_at` text NOT NULL,
  `password_hash` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `password_credentials_updated_at_idx` ON `password_credentials` (`updated_at`);
