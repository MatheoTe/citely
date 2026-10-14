"use client";

import { Hash, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn, pageLabel, sectionLabel } from "@/lib/utils";

export interface ExplorerChunk {
  id: string;
  ordinal: number;
  content: string;
  headingPath: string;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
}

function highlight(text: string, query: string) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="cite-mark">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/** Outline + full-text filter over a document's chunks; #chunk-… deep links are highlighted. */
export function ChunkExplorer({ chunks }: { chunks: ExplorerChunk[] }) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<string | null>(null);

  const sections = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of chunks) map.set(c.headingPath, (map.get(c.headingPath) ?? 0) + 1);
    return [...map.entries()];
  }, [chunks]);
  const maxTokens = Math.max(...chunks.map((c) => c.tokenCount), 1);

  const visible = chunks.filter(
    (c) => (!section || c.headingPath === section) && (!query || c.content.toLowerCase().includes(query.toLowerCase())),
  );

  // Deep links from citations: make sure the target chunk is rendered and in view.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Outline</p>
        <nav className="surface max-h-[60vh] space-y-0.5 overflow-y-auto p-2 text-[13px]">
          <button
            type="button"
            onClick={() => setSection(null)}
            className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted", !section && "bg-muted font-medium")}
          >
            All sections <span className="font-mono text-[11px] text-muted-foreground">{chunks.length}</span>
          </button>
          {sections.map(([path, count]) => (
            <button
              key={path || "root"}
              type="button"
              onClick={() => setSection(path)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted",
                section === path && "bg-muted font-medium text-foreground",
              )}
            >
              <span className="truncate text-muted-foreground">{sectionLabel(path) || "Introduction"}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{count}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="space-y-4">
        <label className="surface flex items-center gap-2 rounded-xl px-3.5 py-2.5 focus-within:shadow-[var(--shadow-elevated),var(--shadow-glow)]">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter chunks…"
            aria-label="Filter chunks"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <span className="font-mono text-[11px] text-muted-foreground">
            {visible.length}/{chunks.length}
          </span>
        </label>

        <ol className="space-y-3">
          {visible.map((chunk) => {
            const page = pageLabel(chunk.pageStart, chunk.pageEnd);
            return (
              <li key={chunk.id} id={`chunk-${chunk.id}`} className="chunk-anchor scroll-mt-28">
                <div className="surface p-5 transition-shadow duration-500">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      <Hash className="size-3" />
                      {chunk.ordinal + 1}
                    </span>
                    <span className="truncate font-medium text-foreground/90">{sectionLabel(chunk.headingPath) || "Introduction"}</span>
                    {page && <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] text-accent-foreground">{page}</span>}
                    <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(chunk.tokenCount / maxTokens) * 100}%` }} />
                      </span>
                      ~{chunk.tokenCount} tok
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/85">{highlight(chunk.content, query)}</p>
                </div>
              </li>
            );
          })}
          {visible.length === 0 && <li className="surface p-8 text-center text-sm text-muted-foreground">No chunk matches “{query}”.</li>}
        </ol>
      </div>
    </div>
  );
}
