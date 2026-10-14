import { ArrowUpRight } from "lucide-react";
import { connection } from "next/server";
import { getEnv } from "@/server/config/env";

export const REPO_URL = "https://github.com/MatheoTe/citely";

/** Thin strip above the header, only in the public demo (DEMO_MODE=1). */
export async function DemoBanner() {
  await connection(); // demo mode is runtime configuration, not a build-time constant
  if (!getEnv().DEMO_MODE) return null;
  return (
    <div
      data-testid="demo-banner"
      className="relative z-50 border-b border-border/60 bg-[linear-gradient(90deg,transparent,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]"
    >
      <div className="mx-auto flex h-8 max-w-6xl items-center justify-center gap-2 px-4 text-[11.5px] text-muted-foreground sm:px-6">
        <span className="relative flex size-1.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
        <span className="truncate">
          <span className="font-medium text-foreground/90">Live demo</span>
          <span className="hidden sm:inline"> · offline mode · fictional corpus · resets nightly</span>
        </span>
        <span className="text-border" aria-hidden="true">
          |
        </span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-0.5 font-medium text-foreground/80 transition-colors hover:text-primary"
        >
          Source on GitHub
          <ArrowUpRight className="size-3" />
        </a>
      </div>
    </div>
  );
}
