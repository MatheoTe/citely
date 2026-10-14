CREATE TYPE "public"."document_status" AS ENUM('queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('pdf', 'markdown');--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"heading_path" text DEFAULT '' NOT NULL,
	"page_start" integer,
	"page_end" integer,
	"token_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"embedding_model" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(heading_path, '')), 'A') || setweight(to_tsvector('english', content), 'B')) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_blobs" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"content_hash" text NOT NULL,
	"byte_size" integer NOT NULL,
	"page_count" integer,
	"status" "document_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"embedding_model" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "embedding_cache" (
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_cache_content_hash_model_pk" PRIMARY KEY("content_hash","model")
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question" text NOT NULL,
	"rewritten_query" text,
	"answer" text,
	"answerable" boolean,
	"status" text NOT NULL,
	"error" text,
	"llm_provider" text NOT NULL,
	"llm_model" text,
	"embedding_model" text NOT NULL,
	"reranker" text,
	"timings" jsonb NOT NULL,
	"retrieval" jsonb NOT NULL,
	"citations" jsonb NOT NULL,
	"usage" jsonb NOT NULL,
	"cost_usd" numeric(12, 6),
	"total_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_blobs" ADD CONSTRAINT "document_blobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_document_ordinal_key" ON "chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_embedding_model_idx" ON "chunks" USING btree ("embedding_model");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_content_hash_key" ON "documents" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "traces_created_at_idx" ON "traces" USING btree ("created_at" DESC NULLS LAST);