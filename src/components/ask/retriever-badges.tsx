import { Badge } from "@/components/ui/badge";
import type { SourceView } from "@/lib/ask-events";

/** Which retriever(s) surfaced a chunk, with its rank in each. */
export function RetrieverBadges({ source }: { source: SourceView }) {
  const both = source.ftsRank !== null && source.vectorRank !== null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {both && <Badge className="border-transparent bg-gradient-to-r from-fts/20 to-vector/20 text-foreground">both</Badge>}
      {source.ftsRank !== null && <Badge variant="fts">FTS #{source.ftsRank}</Badge>}
      {source.vectorRank !== null && <Badge variant="vector">vector #{source.vectorRank}</Badge>}
      {source.rerankScore !== null && <Badge variant="default">rerank {source.rerankScore.toFixed(2)}</Badge>}
    </span>
  );
}
