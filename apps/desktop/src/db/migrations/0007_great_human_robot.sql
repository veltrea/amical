ALTER TABLE `misrecognition_candidates` ADD `detector_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `misrecognition_candidates` ADD `context_sample` text;--> statement-breakpoint
ALTER TABLE `misrecognition_candidates` ADD `detector_scores` text;