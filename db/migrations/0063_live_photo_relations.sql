ALTER TABLE draft_item ADD COLUMN live_photo_group_id TEXT;
--> statement-breakpoint
ALTER TABLE draft_item ADD COLUMN live_photo_role TEXT CHECK (live_photo_role IS NULL OR live_photo_role IN ('image','video'));
--> statement-breakpoint
ALTER TABLE memory_event_asset ADD COLUMN live_photo_group_id TEXT;
--> statement-breakpoint
ALTER TABLE memory_event_asset ADD COLUMN live_photo_role TEXT CHECK (live_photo_role IS NULL OR live_photo_role IN ('image','video'));
