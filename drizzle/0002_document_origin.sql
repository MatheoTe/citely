CREATE TYPE "public"."document_origin" AS ENUM('sample', 'upload');--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "origin" "document_origin" DEFAULT 'upload' NOT NULL;