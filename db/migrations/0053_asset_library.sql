ALTER TABLE asset ADD COLUMN participant_ids_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE asset ADD COLUMN metadata_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE collection_item ADD COLUMN asset_id TEXT REFERENCES asset(id) ON DELETE SET NULL CHECK(asset_id IS NULL OR memory_event_id IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX collection_item_asset_uidx ON collection_item(collection_id, asset_id);
