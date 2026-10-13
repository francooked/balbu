CREATE TABLE "error_diagnosis" (
	"error_identity_id" integer PRIMARY KEY NOT NULL,
	"diagnosis" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_diagnosis_message_rewrite" (
	"error_identity_id" integer NOT NULL,
	"message_rewrite_id" integer NOT NULL,
	CONSTRAINT "error_diagnosis_message_rewrite_error_identity_id_message_rewrite_id_pk" PRIMARY KEY("error_identity_id","message_rewrite_id")
);
--> statement-breakpoint
ALTER TABLE "error_diagnosis" ADD CONSTRAINT "error_diagnosis_error_identity_id_error_identity_id_fk" FOREIGN KEY ("error_identity_id") REFERENCES "public"."error_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_diagnosis_message_rewrite" ADD CONSTRAINT "error_diagnosis_message_rewrite_error_identity_id_error_diagnosis_error_identity_id_fk" FOREIGN KEY ("error_identity_id") REFERENCES "public"."error_diagnosis"("error_identity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_diagnosis_message_rewrite" ADD CONSTRAINT "error_diagnosis_message_rewrite_message_rewrite_id_message_rewrite_id_fk" FOREIGN KEY ("message_rewrite_id") REFERENCES "public"."message_rewrite"("id") ON DELETE cascade ON UPDATE no action;