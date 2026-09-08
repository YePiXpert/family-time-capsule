CREATE TABLE memory_mutation (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  memory_event_id TEXT NOT NULL REFERENCES memory_event(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX memory_mutation_actor_key_idx ON memory_mutation(family_id, actor_user_id, mutation_id);
