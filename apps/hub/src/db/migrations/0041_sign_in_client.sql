CREATE TABLE "sb_sign_in_client" (
	"redirect_uri" text NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_sign_in_client_redirect_uri_name_pk" PRIMARY KEY("redirect_uri","name")
);
