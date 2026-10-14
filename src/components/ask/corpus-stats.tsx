import { Clock3, FileStack, Layers, ScrollText } from "lucide-react";
import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { getCorpusStats } from "@/server/repositories";

function relativeTime(date: Date | null): string {
  if (!date) return "never";
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  const units: [number, string][] = [
    [86400, "d"],
    [3600, "h"],
    [60, "min"],
  ];
  for (const [size, label] of units) if (seconds >= size) return `${Math.floor(seconds / size)} ${label} ago`;
  return "just now";
}

function Stat({ icon: Icon, value, label }: { icon: typeof Clock3; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="text-left">
        <span className="block font-display text-[15px] font-semibold tabular-nums leading-tight">{value}</span>
        <span className="block text-[11px] text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

/** Live corpus summary for the empty state. */
export async function CorpusStatsStrip() {
  await connection();
  const stats = await getCorpusStats(await getDb());
  return (
    <div className="surface grid grid-cols-2 divide-border/60 sm:grid-cols-4 sm:divide-x" data-testid="corpus-stats">
      <Stat icon={FileStack} value={`${stats.readyDocuments}/${stats.documents}`} label="documents indexed" />
      <Stat icon={Layers} value={stats.chunks.toLocaleString()} label="searchable chunks" />
      <Stat icon={ScrollText} value={stats.pages ? stats.pages.toLocaleString() : "—"} label="PDF pages" />
      <Stat icon={Clock3} value={relativeTime(stats.lastIndexedAt)} label="last indexed" />
    </div>
  );
}

export function CorpusStatsSkeleton() {
  return <div className="surface h-[62px] animate-pulse" />;
}
