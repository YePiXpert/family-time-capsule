CREATE TABLE ai_dispatch (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('job','search','diagnostic')),
  family_id TEXT,
  user_id TEXT,
  configuration_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL,
  images INTEGER NOT NULL,
  audio_seconds INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved','dispatched','responded','uncertain','cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX ai_dispatch_created_idx ON ai_dispatch(created_at);
--> statement-breakpoint
CREATE TABLE ai_search_operation (
  id TEXT PRIMARY KEY NOT NULL,
  instance_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  configuration_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  consent_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','completed','failed')),
  result_json TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX ai_search_actor_created_idx ON ai_search_operation(family_id,user_id,created_at);
