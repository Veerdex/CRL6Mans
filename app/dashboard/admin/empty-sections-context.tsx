"use client";

import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "admin-show-empty-sections";
const ShowEmptySectionsContext = createContext(false);

export function useShowEmptySections() {
  return useContext(ShowEmptySectionsContext);
}

// This whole feature is desktop-only — mobile keeps every section visible, same as before.
const DESKTOP_QUERY = "(min-width: 768px)";

export function EmptySectionsProvider({ children }: { children: React.ReactNode }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setShowEmpty(localStorage.getItem(STORAGE_KEY) === "1");

    const mql = window.matchMedia(DESKTOP_QUERY);
    setIsDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    setShowEmpty((v) => {
      const next = !v;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "e") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const effectiveShowEmpty = !isDesktop || showEmpty;

  return (
    <ShowEmptySectionsContext.Provider value={effectiveShowEmpty}>
      {children}
      <button
        onClick={toggle}
        className="fixed bottom-4 right-4 z-50 hidden md:block text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-900/80 border border-zinc-800 rounded-lg px-3 py-1.5 transition-colors"
      >
        Ctrl+Shift+E: {showEmpty ? "hide" : "show"} empty sections
      </button>
    </ShowEmptySectionsContext.Provider>
  );
}
