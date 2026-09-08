ALTER TABLE draft ADD COLUMN reviewed_revision INTEGER;
--> statement-breakpoint
UPDATE draft SET reviewed_revision=revision WHERE inbox_item_id IS NOT NULL;
