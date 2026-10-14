import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowLeft, Cpu, FileText, FileType2, Layers, ScrollText } from "lucide-react";
import { ChunkExplorer } from "@/components/documents/chunk-explorer";
import { StatusBadge } from "@/components/documents/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";
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
  const Icon = doc.sourceType === "pdf" ? FileType2 : FileText;

  return (
    <div className="space-y-8">
      <div className="surface flex flex-wrap items-start gap-5 p-6">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">{doc.title}</h1>
            <StatusBadge status={doc.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {doc.filename} · {formatBytes(doc.byteSize)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              <Layers /> {doc.chunkCount} chunks
            </Badge>
            {doc.pageCount ? (
              <Badge variant="outline">
                <ScrollText /> {doc.pageCount} pages
              </Badge>
            ) : null}
            {doc.embeddingModel && (
              <Badge variant="outline" className="font-mono">
                <Cpu /> {doc.embeddingModel}
              </Badge>
            )}
          </div>
          {doc.error && <p className="text-sm text-destructive">{doc.error}</p>}
        </div>
      </div>
      <ChunkExplorer chunks={doc.chunks} />
    </div>
  );
}

export default function DocumentPage({ params }: PageProps<"/documents/[id]">) {
  return (
    <div className="space-y-6">
      <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> All documents
      </Link>
      <Suspense
        fallback={
          <div className="space-y-3">
            <div className="surface h-32 animate-pulse" />
            <div className="surface h-64 animate-pulse" />
          </div>
        }
      >
        <DocumentDetail params={params} />
      </Suspense>
    </div>
  );
}
