import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { DocumentLibrary, type DocumentItem } from "@/components/documents/document-library";
import { PageHeader } from "@/components/page-header";
import { getEnv, maxUploadBytes } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { getProgress } from "@/server/ingest/progress";
import { listDocuments } from "@/server/repositories";

export const metadata: Metadata = { title: "Documents" };

async function Library() {
  await connection();
  const rows = await listDocuments(await getDb());
  // Dates cross the server/client boundary as ISO strings, matching the JSON API.
  const initial: DocumentItem[] = rows.map((d) => ({
    ...d,
    createdAt: d.createdAt.toISOString(),
    progress: getProgress(d.id),
  }));
  const env = getEnv();
  return <DocumentLibrary initialDocuments={initial} demo={env.DEMO_MODE} maxUploadBytes={maxUploadBytes(env)} />;
}

export default function DocumentsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Ingestion"
        title="Documents"
        description="Every upload is content-hashed, parsed with page numbers, chunked along its headings, embedded and indexed for hybrid search — in the background, with live progress."
      />
      <Suspense
        fallback={
          <div className="space-y-3">
            <div className="surface h-44 animate-pulse" />
            <div className="surface h-20 animate-pulse" />
            <div className="surface h-20 animate-pulse" />
          </div>
        }
      >
        <Library />
      </Suspense>
    </div>
  );
}
