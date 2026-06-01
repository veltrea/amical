ALTER TABLE `vocabulary` ADD `source` text;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `is_active` integer DEFAULT true NOT NULL;