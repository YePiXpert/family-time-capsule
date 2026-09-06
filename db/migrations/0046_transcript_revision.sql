ALTER TABLE `asset_transcript` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TRIGGER asset_transcript_revision_insert_guard
BEFORE INSERT ON asset_transcript
WHEN typeof(NEW.revision) <> 'integer' OR NEW.revision < 0
BEGIN SELECT RAISE(ABORT, 'invalid transcript revision'); END;
--> statement-breakpoint
CREATE TRIGGER asset_transcript_revision_update_guard
BEFORE UPDATE ON asset_transcript
WHEN typeof(NEW.revision) <> 'integer' OR NEW.revision < OLD.revision
BEGIN SELECT RAISE(ABORT, 'transcript revision cannot decrease'); END;
