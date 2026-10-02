CREATE TYPE "public"."preset_origin" AS ENUM('system', 'community', 'user');--> statement-breakpoint
CREATE TABLE "conversation_preset" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text,
	"origin" "preset_origin" NOT NULL,
	"kind" "chat_kind" NOT NULL,
	"name" text NOT NULL,
	"briefing" text NOT NULL,
	"context" jsonb NOT NULL,
	"author_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversationpreset_slug_uq" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "conversation_preset" ADD CONSTRAINT "conversation_preset_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;