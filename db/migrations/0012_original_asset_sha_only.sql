DROP INDEX `asset_family_sha_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `asset_family_sha_idx` ON `asset` (`family_id`,`sha256`) WHERE "asset"."original_asset_id" is null;