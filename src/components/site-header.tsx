import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ModeBadge } from "@/components/mode-badge";
import { NavLinks, StaticNavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { describeProviders, getProviders } from "@/server/providers";

async function ProviderBadge() {
  await connection(); // provider mode depends on runtime env, not build-time env
  return <ModeBadge mode={describeProviders(getProviders())} />;
}

export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <span
      className={`relative grid ${className} place-items-center overflow-hidden rounded-[10px] bg-[conic-gradient(from_210deg,oklch(0.58_0.24_285),oklch(0.62_0.17_225),oklch(0.6_0.22_330),oklch(0.58_0.24_285))] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.35),0_4px_16px_-4px_color-mix(in_oklch,var(--primary)_70%,transparent)]`}
    >
      <svg viewBox="0 0 24 24" className="size-[55%] text-white drop-shadow" fill="none" aria-hidden="true">
        <path d="M7 7h4v4c0 3-1.6 5-4 6M14 7h4v4c0 3-1.6 5-4 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="glass sticky top-0 z-40 border-b border-border/70 shadow-[0_1px_0_0_var(--surface-highlight),0_10px_30px_-20px_rgb(0_0_0/0.6)]">
      <div className="mx-auto flex h-15 max-w-6xl items-center gap-5 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="font-display text-[17px] font-semibold tracking-tight">Citevia</span>
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
