CREATE TABLE "error_identity" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"target_language" "language_code" NOT NULL,
	"label" text NOT NULL,
	"applies_when" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "message_rewrite" ADD COLUMN "error_identity_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "error_identity" ADD CONSTRAINT "error_identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "erroridentity_userid_language_idx" ON "error_identity" USING btree ("user_id","target_language");--> statement-breakpoint
ALTER TABLE "message_rewrite" ADD CONSTRAINT "message_rewrite_error_identity_id_error_identity_id_fk" FOREIGN KEY ("error_identity_id") REFERENCES "public"."error_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messagerewrite_erroridentityid_idx" ON "message_rewrite" USING btree ("error_identity_id");