import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { DocumentLibrary, type DocumentItem } from "@/components/documents/document-library";
import { Skeleton } from "@/components/ui/skeleton";
import { getDb } from "@/server/db/client";
import { listDocuments } from "@/server/repositories";

export const metadata: Metadata = { title: "Documents" };

async function Library() {
  await connection();
  const rows = await listDocuments(await getDb());
  // Dates cross the server/client boundary as ISO strings, matching the JSON API.
  const initial: DocumentItem[] = rows.map((d) => ({
    ...d,
    createdAt: d.createdAt.toISOString(),
  }));
  return <DocumentLibrary initialDocuments={initial} />;
}

export default function DocumentsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Uploads are parsed, chunked along their headings, embedded and indexed for hybrid search in the background.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        }
      >
        <Library />
      </Suspense>
    </div>
  );
}
