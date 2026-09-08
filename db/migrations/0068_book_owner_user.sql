ALTER TABLE book_project ADD COLUMN owner_user_id TEXT REFERENCES user(id);
--> statement-breakpoint
-- Only an existing explicit account/Person binding establishes legacy ownership.
-- A Person with no account never becomes an automatic future account grant.
UPDATE book_project SET owner_user_id=(SELECT id FROM user WHERE user.family_id=book_project.family_id AND user.person_id=book_project.owner_person_id LIMIT 1);
