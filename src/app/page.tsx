import { Suspense } from "react";
import { AskWorkspace } from "@/components/ask/ask-workspace";
import { CorpusStatsSkeleton, CorpusStatsStrip } from "@/components/ask/corpus-stats";

export default function AskPage() {
  return (
    <AskWorkspace
      stats={
        <Suspense fallback={<CorpusStatsSkeleton />}>
          <CorpusStatsStrip />
        </Suspense>
      }
    />
  );
}
