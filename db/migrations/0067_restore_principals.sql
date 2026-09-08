CREATE TABLE restore_principal (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  archive_principal_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  state TEXT NOT NULL CHECK(state IN ('unresolved','bound')),
  bound_at INTEGER,
  UNIQUE(family_id,archive_principal_id)
);
--> statement-breakpoint
CREATE TABLE restored_review_asset (
  family_id TEXT NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  inbox_item_id TEXT NOT NULL REFERENCES inbox_item(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  PRIMARY KEY(inbox_item_id,asset_id)
);
--> statement-breakpoint
CREATE TRIGGER unresolved_restore_user_stays_disabled BEFORE UPDATE OF disabled_at ON user
WHEN NEW.disabled_at IS NULL AND EXISTS (SELECT 1 FROM restore_principal WHERE user_id=OLD.id AND state='unresolved')
BEGIN SELECT RAISE(ABORT, 'unresolved_restore_principal'); END;
