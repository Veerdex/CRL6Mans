"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Tabs are a desktop-only navigation layer — on mobile every section still
// renders in its original order, exactly as before this feature existed.
const DESKTOP_QUERY = "(min-width: 768px)";

interface AdminTabsState {
  isDesktop: boolean;
  activeTab: number;
  setActiveTab: (i: number) => void;
}

const AdminTabsContext = createContext<AdminTabsState>({
  isDesktop: false,
  activeTab: 0,
  setActiveTab: () => {},
});

export function AdminTabsProvider({ children }: { children: React.ReactNode }) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    setIsDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return (
    <AdminTabsContext.Provider value={{ isDesktop, activeTab, setActiveTab }}>
      {children}
    </AdminTabsContext.Provider>
  );
}

export function AdminTabsBar({ labels, counts }: { labels: string[]; counts?: number[] }) {
  const { isDesktop, activeTab, setActiveTab } = useContext(AdminTabsContext);

  if (!isDesktop) return null;

  return (
    <div className="hidden md:flex gap-1 overflow-x-auto border-b border-zinc-800 mb-8">
      {labels.map((label, i) => {
        const count = counts?.[i] ?? 0;
        return (
          <button
            key={label}
            onClick={() => setActiveTab(i)}
            className={`shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === i
                ? "border-indigo-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
            {count > 0 && (
              <span className="text-xs font-medium bg-indigo-600 text-white px-2 py-0.5 rounded-full">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function AdminTabSection({ tab, children }: { tab: number; children: React.ReactNode }) {
  const { isDesktop, activeTab } = useContext(AdminTabsContext);

  if (isDesktop && tab !== activeTab) return null;

  return <>{children}</>;
}
