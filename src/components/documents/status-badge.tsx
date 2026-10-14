import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Status = "queued" | "processing" | "ready" | "failed";

export function StatusBadge({ status }: { status: Status }) {
  switch (status) {
    case "ready":
      return (
        <Badge variant="success" data-status="ready">
          <CheckCircle2 /> Ready
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" data-status="failed">
          <XCircle /> Failed
        </Badge>
      );
    case "processing":
      return (
        <Badge data-status="processing">
          <Loader2 className="animate-spin" /> Processing
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" data-status="queued">
          <Clock /> Queued
        </Badge>
      );
  }
}
