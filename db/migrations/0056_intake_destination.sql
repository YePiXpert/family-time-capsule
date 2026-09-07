ALTER TABLE import_session ADD COLUMN intake_destination text NOT NULL DEFAULT 'pending' CHECK(intake_destination IN ('pending','draft','library'));
--> statement-breakpoint
ALTER TABLE import_session ADD COLUMN intake_draft_id text REFERENCES draft(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE import_session ADD COLUMN intake_revision integer NOT NULL DEFAULT 0 CHECK(intake_revision >= 0);
