"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const order = ["system", "light", "dark"] as const;
const icons = { system: Monitor, light: Sun, dark: Moon };
const noop = () => () => {};

export function ThemeToggle() {
  const { theme = "system", setTheme } = useTheme();
  // Theme is only known on the client; render a stable placeholder during SSR.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const current = (mounted ? theme : "system") as (typeof order)[number];
  const Icon = icons[current] ?? Monitor;
  const next = order[(order.indexOf(current) + 1) % order.length];

  return (
    <Button variant="ghost" size="icon" aria-label={`Theme: ${current}. Switch to ${next}`} title={`Theme: ${current}`} onClick={() => setTheme(next)}>
      <Icon />
    </Button>
  );
}
