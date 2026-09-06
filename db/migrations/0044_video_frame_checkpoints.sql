CREATE TABLE `ai_video_frame` (
	`job_id` text NOT NULL,
	`frame_index` integer NOT NULL,
	`at_ms` integer NOT NULL,
	`frame_sha256` text NOT NULL,
	`prompt_version` text NOT NULL,
	`description` text NOT NULL,
	`ocr_text` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`job_id`, `frame_index`),
	FOREIGN KEY (`job_id`) REFERENCES `ai_job`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_video_frame_bounds" CHECK(typeof("ai_video_frame"."frame_index") = 'integer' and "ai_video_frame"."frame_index" between 0 and 5 and typeof("ai_video_frame"."at_ms") = 'integer' and "ai_video_frame"."at_ms" between 0 and 120000 and length("ai_video_frame"."description") between 1 and 4000 and ("ai_video_frame"."ocr_text" is null or length("ai_video_frame"."ocr_text") <= 2000)),
	CONSTRAINT "ai_video_frame_identity" CHECK(length("ai_video_frame"."frame_sha256") = 64 and "ai_video_frame"."frame_sha256" not glob '*[^0-9a-f]*' and length("ai_video_frame"."prompt_version") between 1 and 64)
);
