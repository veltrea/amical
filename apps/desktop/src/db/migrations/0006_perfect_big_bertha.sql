CREATE TABLE `misrecognition_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`normalized_key` text NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`dismissed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `misrecognition_candidates_word_unique` ON `misrecognition_candidates` (`word`);--> statement-breakpoint
CREATE INDEX `misrecognition_candidates_normalized_key_idx` ON `misrecognition_candidates` (`normalized_key`);--> statement-breakpoint
CREATE INDEX `misrecognition_candidates_dismissed_idx` ON `misrecognition_candidates` (`dismissed`);--> statement-breakpoint
CREATE INDEX `misrecognition_candidates_occurrence_count_idx` ON `misrecognition_candidates` (`occurrence_count`);--> statement-breakpoint
CREATE TABLE `misrecognition_scan_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_scanned_transcription_id` integer DEFAULT 0 NOT NULL,
	`last_scan_at` integer
);
