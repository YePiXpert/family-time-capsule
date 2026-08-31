CREATE TABLE `family_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`family_id` text NOT NULL,
	`role` text NOT NULL,
	`email` text,
	`person_id` text,
	`expires_at` integer NOT NULL,
	`claim_nonce` text,
	`claim_expires_at` integer,
	`provisioned_user_id` text,
	`used_at` integer,
	`used_by_user_id` text,
	`revoked_at` integer,
	`revoked_by_user_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `family`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "family_invitation_token_hash_length_check" CHECK(length("family_invitation"."token_hash") = 64),
	CONSTRAINT "family_invitation_role_check" CHECK("family_invitation"."role" in ('admin', 'editor', 'contributor', 'viewer')),
	CONSTRAINT "family_invitation_claim_pair_check" CHECK((("family_invitation"."claim_nonce" is null) and ("family_invitation"."claim_expires_at" is null)) or (("family_invitation"."claim_nonce" is not null) and ("family_invitation"."claim_expires_at" is not null)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `family_invitation_token_hash_uidx` ON `family_invitation` (`token_hash`);--> statement-breakpoint
CREATE INDEX `family_invitation_family_created_idx` ON `family_invitation` (`family_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `family_invitation_person_idx` ON `family_invitation` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_person_uidx` ON `user` (`person_id`) WHERE "user"."person_id" is not null;