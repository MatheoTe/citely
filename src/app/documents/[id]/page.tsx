import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { StatusBadge } from "@/components/documents/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, pageLabel } from "@/lib/utils";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { idParamSchema } from "@/server/http/schemas";
import { getDocumentWithChunks } from "@/server/repositories";

async function DocumentDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const parsed = idParamSchema.safeParse(await params);
  if (!parsed.success) notFound();

  let doc: Awaited<ReturnType<typeof getDocumentWithChunks>>;
  try {
    doc = await getDocumentWithChunks(await getDb(), parsed.data.id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
          <StatusBadge status={doc.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {doc.filename} · {formatBytes(doc.byteSize)}
          {doc.pageCount ? ` · ${doc.pageCount} pages` : ""} · {doc.chunkCount} chunks
          {doc.embeddingModel ? ` · ${doc.embeddingModel}` : ""}
        </p>
        {doc.error && <p className="text-sm text-destructive">{doc.error}</p>}
      </div>

      <ol className="space-y-3">
        {doc.chunks.map((chunk) => {
          const page = pageLabel(chunk.pageStart, chunk.pageEnd);
          return (
            <li key={chunk.id} id={`chunk-${chunk.id}`} className="chunk-anchor scroll-mt-24 rounded-xl">
              <Card className="p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">#{chunk.ordinal + 1}</Badge>
                  {chunk.headingPath && <span className="font-medium text-foreground">{chunk.headingPath}</span>}
                  {page && <Badge variant="outline">{page}</Badge>}
                  <span className="ml-auto font-mono">~{chunk.tokenCount} tokens</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6">{chunk.content}</p>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function DocumentPage({ params }: PageProps<"/documents/[id]">) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All documents
      </Link>
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        }
      >
        <DocumentDetail params={params} />
      </Suspense>
    </div>
  );
}
