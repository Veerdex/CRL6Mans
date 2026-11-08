"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

// The path a click is navigating to, so every nav highlights the destination on the click
// itself rather than when the route commits. One document listener feeds every subscriber;
// the pending path is dropped as soon as the pathname moves or history is walked.
let pending: string | null = null;
const listeners = new Set<() => void>();

function setPending(next: string | null) {
  if (next === pending) return;
  pending = next;
  listeners.forEach((l) => l());
}

function onClick(e: MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement) || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
  const url = new URL(a.href);
  if (url.origin !== location.origin || url.pathname === location.pathname) return;
  setPending(url.pathname);
}

const clear = () => setPending(null);

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", clear);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", clear);
    }
  };
}

export function useNavPathname() {
  const pathname = usePathname();
  const clicked = useSyncExternalStore(subscribe, () => pending, () => null);
  useEffect(clear, [pathname]);
  return clicked ?? pathname;
}
