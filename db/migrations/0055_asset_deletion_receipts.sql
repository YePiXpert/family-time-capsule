CREATE TABLE asset_deletion (
  asset_id text PRIMARY KEY NOT NULL,
  family_id text NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  deleted_at text NOT NULL,
  requested_by_user_id text REFERENCES user(id) ON DELETE SET NULL,
  storage_keys_json text NOT NULL DEFAULT '[]',
  cleaned_at text,
  CHECK (length(sha256)=64),
  CHECK (json_valid(storage_keys_json) AND json_type(storage_keys_json)='array')
);
--> statement-breakpoint
CREATE INDEX asset_deletion_family_idx ON asset_deletion(family_id,deleted_at);
