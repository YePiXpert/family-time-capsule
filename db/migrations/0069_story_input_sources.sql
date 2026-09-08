ALTER TABLE story ADD COLUMN input_sources_json TEXT DEFAULT '[]' CHECK (input_sources_json IS NULL OR (json_valid(input_sources_json) AND json_type(input_sources_json)='array'));
--> statement-breakpoint
-- Old restore removed job provenance, so no existing row proves the complete input.
-- Retain the human/derived text, but do not infer a complete input manifest.
UPDATE story SET input_sources_json=NULL;
