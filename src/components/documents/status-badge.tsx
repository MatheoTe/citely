import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Status = "queued" | "processing" | "ready" | "failed";

/** `data-status` is the durable state; `label` can show the in-flight sub-stage. */
export function StatusBadge({ status, label }: { status: Status; label?: string }) {
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
        <Badge data-status="processing" className="capitalize">
          <Loader2 className="animate-spin" /> {label ?? "Processing"}
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
