CREATE TABLE collection_sync_identity (
  family_id TEXT NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  client_album_id TEXT NOT NULL,
  collection_id TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  PRIMARY KEY (family_id, actor_user_id, client_album_id)
);
--> statement-breakpoint
CREATE TABLE collection_sync_mutation (
  family_id TEXT NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  collection_id TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (family_id, actor_user_id, mutation_id)
);
