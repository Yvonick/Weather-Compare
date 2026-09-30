CREATE TABLE `shared_comparisons` (
	`token` text PRIMARY KEY NOT NULL,
	`settings_hash` text NOT NULL,
	`query` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_comparisons_settings_hash_unique` ON `shared_comparisons` (`settings_hash`);