-- Transactional synchronization journal. Payloads contain ids/policy only, never family content.
CREATE INDEX sync_memory_cover_idx ON memory_event(cover_asset_id,family_id);
--> statement-breakpoint
CREATE INDEX sync_asset_parent_idx ON asset(original_asset_id,family_id);
--> statement-breakpoint
CREATE TABLE sync_state (id TEXT PRIMARY KEY NOT NULL, generation TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0, floor_seq INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
INSERT INTO sync_state(id,generation) VALUES ('instance',lower(hex(randomblob(16))));
--> statement-breakpoint
CREATE TABLE sync_scope (family_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL DEFAULT 0, permission_revision INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
INSERT INTO sync_scope(family_id) SELECT id FROM family;
--> statement-breakpoint
CREATE TABLE sync_change (seq INTEGER PRIMARY KEY AUTOINCREMENT, family_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('memory','person','cache')), entity_id TEXT,
 operation TEXT NOT NULL CHECK(operation IN ('upsert','delete','invalidate')),
 visibility TEXT, author_user_id TEXT, reader_ids_json TEXT NOT NULL DEFAULT '[]',
 reset_scope INTEGER NOT NULL DEFAULT 0 CHECK(reset_scope IN (0,1)), revocation INTEGER NOT NULL DEFAULT 0 CHECK(revocation IN (0,1)), created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX sync_change_family_seq_idx ON sync_change(family_id,seq);
--> statement-breakpoint
CREATE TABLE sync_cursor (id TEXT PRIMARY KEY NOT NULL,user_id TEXT NOT NULL,family_id TEXT NOT NULL,state_json TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX sync_cursor_user_created_idx ON sync_cursor(user_id,created_at);
--> statement-breakpoint
CREATE INDEX sync_cursor_expiry_idx ON sync_cursor(expires_at);
--> statement-breakpoint
CREATE TRIGGER sync_change_clock AFTER INSERT ON sync_change BEGIN
 INSERT INTO sync_scope(family_id,revision,permission_revision) VALUES(NEW.family_id,NEW.seq,NEW.reset_scope)
 ON CONFLICT(family_id) DO UPDATE SET revision=NEW.seq,permission_revision=permission_revision+NEW.reset_scope;
 UPDATE sync_state SET last_seq=NEW.seq WHERE id='instance';
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_insert AFTER INSERT ON memory_event BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'memory',NEW.id,'upsert',NEW.visibility,NEW.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=NEW.id AND family_id=NEW.family_id),0,0,unixepoch() WHERE NEW.status='confirmed' AND NEW.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_update AFTER UPDATE ON memory_event BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'memory',NEW.id,'upsert',NEW.visibility,NEW.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=NEW.id AND family_id=NEW.family_id),CASE WHEN OLD.visibility IS NOT NEW.visibility OR OLD.created_by_user_id IS NOT NEW.created_by_user_id OR OLD.family_id IS NOT NEW.family_id OR OLD.child_person_id IS NOT NEW.child_person_id THEN 1 ELSE 0 END,0,unixepoch() WHERE NEW.status='confirmed' AND NEW.deleted_at IS NULL;
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'memory',OLD.id,'delete',OLD.visibility,OLD.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=OLD.id AND family_id=OLD.family_id),0,1,unixepoch() WHERE (OLD.status='confirmed' AND OLD.deleted_at IS NULL) AND (NOT (NEW.status='confirmed' AND NEW.deleted_at IS NULL) OR OLD.family_id IS NOT NEW.family_id);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND ((OLD.visibility IS NOT NEW.visibility OR OLD.created_by_user_id IS NOT NEW.created_by_user_id OR OLD.family_id IS NOT NEW.family_id OR OLD.child_person_id IS NOT NEW.child_person_id) AND (NOT (NEW.status='confirmed' AND NEW.deleted_at IS NULL) OR OLD.family_id IS NOT NEW.family_id));
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_delete BEFORE DELETE ON memory_event BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'memory',OLD.id,'delete',OLD.visibility,OLD.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=OLD.id AND family_id=OLD.family_id),0,1,unixepoch() WHERE OLD.status='confirmed' AND OLD.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_reader_insert AFTER INSERT ON memory_event_reader BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (EXISTS(SELECT 1 FROM memory_event e WHERE e.id=NEW.memory_event_id AND e.deleted_at IS NULL));
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_asset_insert AFTER INSERT ON memory_event_asset BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id AND e.family_id=NEW.family_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_participant_insert AFTER INSERT ON memory_event_participant BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id AND e.family_id=NEW.family_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_tag_insert AFTER INSERT ON memory_event_tag BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id AND e.family_id=NEW.family_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_person_insert AFTER INSERT ON person BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) VALUES (NEW.family_id,'person',NEW.id,'upsert','family',NULL,'[]',0,0,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_family_insert AFTER INSERT ON family BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_user_insert AFTER INSERT ON user BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_contribution_insert AFTER INSERT ON contribution BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,1,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT (SELECT family_id FROM memory_event WHERE id=NEW.memory_event_id),'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE (SELECT family_id FROM memory_event WHERE id=NEW.memory_event_id) IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_fact_insert AFTER INSERT ON fact BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_fact_source_insert AFTER INSERT ON fact_source BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=(SELECT memory_event_id FROM fact WHERE id=NEW.fact_id));
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_reader_update AFTER UPDATE ON memory_event_reader BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (EXISTS(SELECT 1 FROM memory_event e WHERE e.id=NEW.memory_event_id AND e.deleted_at IS NULL));
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_asset_update AFTER UPDATE ON memory_event_asset BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,1,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id AND e.family_id=NEW.family_id);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (EXISTS(SELECT 1 FROM memory_event e WHERE e.id=NEW.memory_event_id AND e.deleted_at IS NULL));
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,1,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=OLD.memory_event_id AND e.family_id=OLD.family_id AND OLD.memory_event_id IS NOT NEW.memory_event_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_participant_update AFTER UPDATE ON memory_event_participant BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id AND e.family_id=NEW.family_id);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,1,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=OLD.memory_event_id AND e.family_id=OLD.family_id AND OLD.memory_event_id IS NOT NEW.memory_event_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_tag_update AFTER UPDATE ON memory_event_tag BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id AND e.family_id=NEW.family_id);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,1,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=OLD.memory_event_id AND e.family_id=OLD.family_id AND OLD.memory_event_id IS NOT NEW.memory_event_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_person_update AFTER UPDATE ON person BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) VALUES (NEW.family_id,'person',NEW.id,'upsert','family',NULL,'[]',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_family_update AFTER UPDATE ON family BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_user_update AFTER UPDATE ON user BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (OLD.family_id IS NOT NEW.family_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_contribution_update AFTER UPDATE ON contribution BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,1,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT (SELECT family_id FROM memory_event WHERE id=NEW.memory_event_id),'cache',NULL,'invalidate',NULL,NULL,'[]',CASE WHEN OLD.visibility IS NOT NEW.visibility OR OLD.author_person_id IS NOT NEW.author_person_id OR OLD.memory_event_id IS NOT NEW.memory_event_id OR OLD.deleted_at IS NOT NEW.deleted_at THEN 1 ELSE 0 END,CASE WHEN OLD.visibility IS NOT NEW.visibility OR OLD.author_person_id IS NOT NEW.author_person_id OR OLD.memory_event_id IS NOT NEW.memory_event_id OR OLD.deleted_at IS NOT NEW.deleted_at THEN 1 ELSE 0 END,unixepoch() WHERE (SELECT family_id FROM memory_event WHERE id=NEW.memory_event_id) IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_fact_update AFTER UPDATE ON fact BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_fact_source_update AFTER UPDATE ON fact_source BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=(SELECT memory_event_id FROM fact WHERE id=NEW.fact_id));
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_reader_delete AFTER DELETE ON memory_event_reader BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (EXISTS(SELECT 1 FROM memory_event e WHERE e.id=OLD.memory_event_id AND e.deleted_at IS NULL));
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_asset_delete AFTER DELETE ON memory_event_asset BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,1,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=OLD.memory_event_id AND e.family_id=OLD.family_id);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (EXISTS(SELECT 1 FROM memory_event e WHERE e.id=OLD.memory_event_id AND e.deleted_at IS NULL));
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_participant_delete AFTER DELETE ON memory_event_participant BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=OLD.memory_event_id AND e.family_id=OLD.family_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_memory_event_tag_delete AFTER DELETE ON memory_event_tag BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=OLD.memory_event_id AND e.family_id=OLD.family_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_person_delete AFTER DELETE ON person BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) VALUES (OLD.family_id,'person',OLD.id,'delete','family',NULL,'[]',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_family_delete AFTER DELETE ON family BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_user_delete AFTER DELETE ON user BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_contribution_delete AFTER DELETE ON contribution BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,1,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=OLD.memory_event_id);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT (SELECT family_id FROM memory_event WHERE id=OLD.memory_event_id),'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE (SELECT family_id FROM memory_event WHERE id=OLD.memory_event_id) IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_fact_delete AFTER DELETE ON fact BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=OLD.memory_event_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_fact_source_delete AFTER DELETE ON fact_source BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=(SELECT memory_event_id FROM fact WHERE id=OLD.fact_id));
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_asset_insert AFTER INSERT ON asset BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT NEW.id,NEW.original_asset_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=NEW.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=NEW.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_asset_transcript_insert AFTER INSERT ON asset_transcript BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT id,original_asset_id FROM asset WHERE id=NEW.asset_id AND family_id=NEW.family_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=NEW.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=NEW.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_asset_analysis_insert AFTER INSERT ON asset_analysis BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT id,original_asset_id FROM asset WHERE id=NEW.asset_id AND family_id=NEW.family_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=NEW.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=NEW.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_document_text_insert AFTER INSERT ON document_text BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT id,original_asset_id FROM asset WHERE id=NEW.asset_id AND family_id=NEW.family_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=NEW.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=NEW.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_story_insert AFTER INSERT ON story BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_story_paragraph_insert AFTER INSERT ON story_paragraph BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_story_source_insert AFTER INSERT ON story_source BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_collection_insert AFTER INSERT ON collection BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_collection_section_insert AFTER INSERT ON collection_section BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_collection_item_insert AFTER INSERT ON collection_item BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_project_insert AFTER INSERT ON book_project BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_chapter_insert AFTER INSERT ON book_chapter BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_block_insert AFTER INSERT ON book_block BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_source_ref_insert AFTER INSERT ON book_source_ref BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_block_source_insert AFTER INSERT ON book_block_source BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_inbox_item_insert AFTER INSERT ON inbox_item BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id AND e.family_id=NEW.family_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_inbox_item_asset_insert AFTER INSERT ON inbox_item_asset BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_ai_suggestion_insert AFTER INSERT ON ai_suggestion BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_resurfacing_preference_insert AFTER INSERT ON resurfacing_preference BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_asset_update AFTER UPDATE ON asset BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',CASE WHEN OLD.visibility IS NOT NEW.visibility OR OLD.created_by_user_id IS NOT NEW.created_by_user_id OR OLD.original_asset_id IS NOT NEW.original_asset_id OR OLD.family_id IS NOT NEW.family_id THEN 1 ELSE 0 END,CASE WHEN OLD.visibility IS NOT NEW.visibility OR OLD.created_by_user_id IS NOT NEW.created_by_user_id OR OLD.original_asset_id IS NOT NEW.original_asset_id OR OLD.family_id IS NOT NEW.family_id THEN 1 ELSE 0 END,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT NEW.id,NEW.original_asset_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=NEW.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=NEW.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_asset_transcript_update AFTER UPDATE ON asset_transcript BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT id,original_asset_id FROM asset WHERE id=NEW.asset_id AND family_id=NEW.family_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=NEW.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=NEW.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_asset_analysis_update AFTER UPDATE ON asset_analysis BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT id,original_asset_id FROM asset WHERE id=NEW.asset_id AND family_id=NEW.family_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=NEW.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=NEW.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_document_text_update AFTER UPDATE ON document_text BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT id,original_asset_id FROM asset WHERE id=NEW.asset_id AND family_id=NEW.family_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=NEW.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=NEW.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=NEW.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_story_update AFTER UPDATE ON story BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',CASE WHEN OLD.status IS NOT NEW.status OR OLD.input_sources_json IS NOT NEW.input_sources_json OR OLD.deleted_at IS NOT NEW.deleted_at THEN 1 ELSE 0 END,CASE WHEN OLD.status IS NOT NEW.status OR OLD.input_sources_json IS NOT NEW.input_sources_json OR OLD.deleted_at IS NOT NEW.deleted_at THEN 1 ELSE 0 END,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_story_paragraph_update AFTER UPDATE ON story_paragraph BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_story_source_update AFTER UPDATE ON story_source BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_collection_update AFTER UPDATE ON collection BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_collection_section_update AFTER UPDATE ON collection_section BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_collection_item_update AFTER UPDATE ON collection_item BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_project_update AFTER UPDATE ON book_project BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',CASE WHEN OLD.audience IS NOT NEW.audience OR OLD.owner_user_id IS NOT NEW.owner_user_id OR OLD.owner_person_id IS NOT NEW.owner_person_id OR OLD.deleted_at IS NOT NEW.deleted_at THEN 1 ELSE 0 END,CASE WHEN OLD.audience IS NOT NEW.audience OR OLD.owner_user_id IS NOT NEW.owner_user_id OR OLD.owner_person_id IS NOT NEW.owner_person_id OR OLD.deleted_at IS NOT NEW.deleted_at THEN 1 ELSE 0 END,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_chapter_update AFTER UPDATE ON book_chapter BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_block_update AFTER UPDATE ON book_block BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_source_ref_update AFTER UPDATE ON book_source_ref BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_block_source_update AFTER UPDATE ON book_block_source BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_inbox_item_update AFTER UPDATE ON inbox_item BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=NEW.memory_event_id AND e.family_id=NEW.family_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_inbox_item_asset_update AFTER UPDATE ON inbox_item_asset BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_ai_suggestion_update AFTER UPDATE ON ai_suggestion BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_resurfacing_preference_update AFTER UPDATE ON resurfacing_preference BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE NEW.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_draft_update AFTER UPDATE ON draft BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT NEW.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE NEW.family_id IS NOT NULL AND (OLD.visibility IS NOT NEW.visibility OR OLD.status IS NOT NEW.status OR OLD.inbox_item_id IS NOT NEW.inbox_item_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_asset_delete AFTER DELETE ON asset BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT OLD.id,OLD.original_asset_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=OLD.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=OLD.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=OLD.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=OLD.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_asset_transcript_delete AFTER DELETE ON asset_transcript BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT id,original_asset_id FROM asset WHERE id=OLD.asset_id AND family_id=OLD.family_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=OLD.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=OLD.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=OLD.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=OLD.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_asset_analysis_delete AFTER DELETE ON asset_analysis BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT id,original_asset_id FROM asset WHERE id=OLD.asset_id AND family_id=OLD.family_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=OLD.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=OLD.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=OLD.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=OLD.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_document_text_delete AFTER DELETE ON document_text BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.id IN (WITH RECURSIVE parents(id,parent_id) AS (SELECT id,original_asset_id FROM asset WHERE id=OLD.asset_id AND family_id=OLD.family_id UNION SELECT a.id,a.original_asset_id FROM asset a JOIN parents p ON a.id=p.parent_id WHERE a.family_id=OLD.family_id), related(id) AS (SELECT id FROM parents WHERE parent_id IS NULL UNION SELECT a.id FROM related r CROSS JOIN asset a ON a.original_asset_id=r.id WHERE a.family_id=OLD.family_id) SELECT id FROM memory_event WHERE cover_asset_id IN (SELECT id FROM related) AND family_id=OLD.family_id UNION SELECT memory_event_id FROM memory_event_asset WHERE asset_id IN (SELECT id FROM related) AND family_id=OLD.family_id UNION SELECT memory_event_id FROM contribution WHERE audio_asset_id IN (SELECT id FROM related)) AND e.status='confirmed' AND e.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sync_story_delete AFTER DELETE ON story BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_story_paragraph_delete AFTER DELETE ON story_paragraph BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_story_source_delete AFTER DELETE ON story_source BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_collection_delete AFTER DELETE ON collection BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_collection_section_delete AFTER DELETE ON collection_section BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_collection_item_delete AFTER DELETE ON collection_item BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_project_delete AFTER DELETE ON book_project BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_chapter_delete AFTER DELETE ON book_chapter BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_block_delete AFTER DELETE ON book_block BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_source_ref_delete AFTER DELETE ON book_source_ref BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_book_block_source_delete AFTER DELETE ON book_block_source BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_inbox_item_delete AFTER DELETE ON inbox_item BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT e.family_id,'memory',e.id,'upsert',e.visibility,e.created_by_user_id,(SELECT coalesce(json_group_array(user_id),'[]') FROM memory_event_reader WHERE memory_event_id=e.id AND family_id=e.family_id),0,0,unixepoch() FROM memory_event e WHERE e.status='confirmed' AND e.deleted_at IS NULL AND (e.id=OLD.memory_event_id AND e.family_id=OLD.family_id);
END;
--> statement-breakpoint
CREATE TRIGGER sync_inbox_item_asset_delete AFTER DELETE ON inbox_item_asset BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_ai_suggestion_delete AFTER DELETE ON ai_suggestion BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_resurfacing_preference_delete AFTER DELETE ON resurfacing_preference BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',0,0,unixepoch() WHERE OLD.family_id IS NOT NULL AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_draft_delete AFTER DELETE ON draft BEGIN
 INSERT INTO sync_change(family_id,kind,entity_id,operation,visibility,author_user_id,reader_ids_json,reset_scope,revocation,created_at) SELECT OLD.family_id,'cache',NULL,'invalidate',NULL,NULL,'[]',1,1,unixepoch() WHERE OLD.family_id IS NOT NULL AND (OLD.inbox_item_id IS NOT NULL);
END;

--> statement-breakpoint
CREATE TRIGGER sync_capsule_insert AFTER INSERT ON capsule BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_update AFTER UPDATE ON capsule BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_delete AFTER DELETE ON capsule BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(OLD.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_asset_insert AFTER INSERT ON capsule_asset BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_asset_update AFTER UPDATE ON capsule_asset BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_asset_delete AFTER DELETE ON capsule_asset BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(OLD.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_event_insert AFTER INSERT ON capsule_event BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_event_update AFTER UPDATE ON capsule_event BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_event_delete AFTER DELETE ON capsule_event BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(OLD.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_contribution_insert AFTER INSERT ON capsule_contribution BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_contribution_update AFTER UPDATE ON capsule_contribution BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_contribution_delete AFTER DELETE ON capsule_contribution BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(OLD.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_future_question_insert AFTER INSERT ON future_question BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_future_question_update AFTER UPDATE ON future_question BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_future_question_delete AFTER DELETE ON future_question BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(OLD.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_reply_insert AFTER INSERT ON capsule_reply BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_reply_update AFTER UPDATE ON capsule_reply BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(NEW.family_id,'cache','invalidate',1,1,unixepoch());
END;
--> statement-breakpoint
CREATE TRIGGER sync_capsule_reply_delete AFTER DELETE ON capsule_reply BEGIN
 INSERT INTO sync_change(family_id,kind,operation,reset_scope,revocation,created_at) VALUES(OLD.family_id,'cache','invalidate',1,1,unixepoch());
END;
