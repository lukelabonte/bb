CREATE TABLE `prompt_template_overrides` (
	`template_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`based_on_default_hash` text NOT NULL,
	`updated_at` integer NOT NULL
);
