"use client";

import Link from "next/link";
import { FileText, FileType2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, formatBytes } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

export interface DocumentItem {
  id: string;
  title: string;
  filename: string;
  sourceType: "pdf" | "markdown";
  byteSize: number;
  pageCount: number | null;
  status: "queued" | "processing" | "ready" | "failed";
  error: string | null;
  chunkCount: number;
  embeddingModel: string | null;
  createdAt: string;
}

const ACCEPT = ".pdf,.md,.markdown,.txt";

export function DocumentLibrary({ initialDocuments }: { initialDocuments: DocumentItem[] }) {
  const [documents, setDocuments] = useState<DocumentItem[]>(initialDocuments);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/documents", { cache: "no-store" });
    if (res.ok) setDocuments(((await res.json()) as { documents: DocumentItem[] }).documents);
  }, []);

  // Poll while anything is still being ingested.
  const pending = documents.some((d) => d.status === "queued" || d.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    setNotice(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/documents", { method: "POST", body: form });
        const body = (await res.json()) as { deduplicated?: boolean; error?: { message: string } };
        if (!res.ok) setNotice({ kind: "error", text: `${file.name}: ${body.error?.message ?? res.statusText}` });
        else if (body.deduplicated) setNotice({ kind: "info", text: `${file.name} is already in the library (same content).` });
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      await refresh();
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    await refresh();
  };

  return (
    <div className="space-y-6">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/30",
          dragging && "border-primary bg-accent/40",
        )}
      >
        <Upload className="size-6 text-muted-foreground" />
        <span className="text-sm font-medium">{uploading ? "Uploading…" : "Drop PDF or Markdown files, or click to browse"}</span>
        <span className="text-xs text-muted-foreground">Text-based PDFs, .md and .txt · identical files are deduplicated</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          data-testid="file-input"
          disabled={uploading}
          onChange={(e) => e.target.files?.length && void upload(e.target.files)}
        />
      </label>

      {notice && (
        <p className={cn("text-sm", notice.kind === "error" ? "text-destructive" : "text-muted-foreground")} role="status">
          {notice.text}
        </p>
      )}

      <Card className="overflow-hidden">
        {documents.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No documents yet. Upload one above, or run <code className="font-mono">npm run seed</code>.
          </p>
        ) : (
          <ul className="divide-y">
            {documents.map((doc) => {
              const Icon = doc.sourceType === "pdf" ? FileType2 : FileText;
              return (
                <li key={doc.id} className="flex items-center gap-4 p-4" data-testid="document-row" data-filename={doc.filename}>
                  <Icon className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/documents/${doc.id}`} className="block truncate text-sm font-medium hover:underline">
                      {doc.title}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {doc.filename} · {formatBytes(doc.byteSize)}
                      {doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
                      {doc.status === "ready" ? ` · ${doc.chunkCount} chunks` : ""}
                      {doc.error ? ` · ${doc.error}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={doc.status} />
                  <Button variant="ghost" size="icon" aria-label={`Delete ${doc.title}`} onClick={() => void remove(doc.id)}>
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
