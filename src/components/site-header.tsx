import Link from "next/link";
import { Quote } from "lucide-react";
import { Suspense } from "react";
import { connection } from "next/server";
import { NavLinks, StaticNavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { describeProviders, getProviders } from "@/server/providers";

async function ProviderBadge() {
  await connection(); // provider mode depends on runtime env, not build-time env
  const mode = describeProviders(getProviders());
  return mode.offline ? (
    <Badge variant="warning" className="hidden sm:inline-flex" title="No API keys configured: local hashed embeddings + extractive answers">
      Offline mode
    </Badge>
  ) : (
    <Badge variant="success" className="hidden sm:inline-flex" title={`LLM: ${mode.llm} · embeddings: ${mode.embeddings}`}>
      {mode.llm}
    </Badge>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Quote className="size-4" />
          </span>
          Citely
        </Link>
        <Suspense fallback={<StaticNavLinks />}>
          <NavLinks />
        </Suspense>
        <div className="ml-auto flex items-center gap-2">
          <Suspense fallback={null}>
            <ProviderBadge />
          </Suspense>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
