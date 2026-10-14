"use client";

import Link from "next/link";
import { ExternalLink, FileText, X } from "lucide-react";
import type { SourceView } from "@/lib/ask-events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { pageLabel, sectionLabel } from "@/lib/utils";

/** The exact chunk a citation points to, with a deep link into the document view. */
export function SourcePanel({ source, onClose }: { source: SourceView; onClose: () => void }) {
  const page = pageLabel(source.pageStart, source.pageEnd);
  return (
    <aside data-testid="source-panel" className="flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-start gap-3 border-b p-4">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary font-mono text-xs font-semibold text-primary-foreground">
          {source.index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{source.documentTitle}</p>
          {sectionLabel(source.headingPath) && (
            <p className="truncate text-xs text-muted-foreground">{sectionLabel(source.headingPath)}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close source">
          <X />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <blockquote className="whitespace-pre-wrap border-l-2 border-primary/60 pl-3 text-sm leading-6">{source.content}</blockquote>
      </div>
      <div className="flex items-center gap-2 border-t p-3">
        <Badge variant="outline">
          <FileText /> chunk {source.chunkId.slice(0, 8)}
        </Badge>
        {page && <Badge variant="outline">{page}</Badge>}
        <Button asChild variant="link" size="sm" className="ml-auto">
          <Link href={`/documents/${source.documentId}#chunk-${source.chunkId}`}>
            Open in document <ExternalLink />
          </Link>
        </Button>
      </div>
    </aside>
  );
}
