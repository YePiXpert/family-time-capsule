ALTER TABLE memory_event ADD COLUMN body_text TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
-- Linked inbox records are the authoritative legacy family source. Published
-- drafts mirror those records; use them only when no nonempty inbox text exists.
UPDATE memory_event SET body_text = COALESCE(
  (SELECT group_concat(raw_text, char(10) || char(10)) FROM
    (SELECT raw_text FROM inbox_item WHERE family_id=memory_event.family_id
      AND memory_event_id=memory_event.id AND length(trim(raw_text)) > 0 ORDER BY created_at,id)),
  (SELECT group_concat(text, char(10) || char(10)) FROM
    (SELECT text FROM draft WHERE family_id=memory_event.family_id
      AND memory_event_id=memory_event.id AND status='published'
      AND length(trim(text)) > 0 ORDER BY created_at,id)), '') ;
