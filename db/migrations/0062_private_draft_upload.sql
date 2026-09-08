ALTER TABLE upload_session ADD COLUMN draft_id TEXT;
--> statement-breakpoint
ALTER TABLE upload_session ADD COLUMN instance_id TEXT;
--> statement-breakpoint
CREATE INDEX upload_session_draft_idx ON upload_session(family_id, user_id, draft_id);
