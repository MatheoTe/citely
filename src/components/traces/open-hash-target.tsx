"use client";

import { useEffect } from "react";

/** Opens the <details> element referenced by the URL hash (links from the Ask page). */
export function OpenHashTarget() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const el = id ? document.getElementById(id) : null;
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      el.scrollIntoView({ block: "start" });
    }
  }, []);
  return null;
}
