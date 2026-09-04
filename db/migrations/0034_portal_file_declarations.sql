ALTER TABLE `import_session_item` ADD `filename` text;--> statement-breakpoint
ALTER TABLE `import_session_item` ADD `declared_mime` text;--> statement-breakpoint
ALTER TABLE `import_session_item` ADD `total_bytes` integer;--> statement-breakpoint
ALTER TABLE `import_session_item` ADD `last_modified` integer;--> statement-breakpoint
ALTER TABLE `import_session_item` ADD `client_fingerprint` text;