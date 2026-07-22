"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Tabs are a desktop-only navigation layer — on mobile every section still
// renders in its original order, exactly as before this feature existed.
const DESKTOP_QUERY = "(min-width: 768px)";

const ACTIVE_TAB_KEY = "crl6mans_admin_active_tab";
// Stores the title of the last CollapsibleSection the admin explicitly opened
// or closed — "" means "explicitly none open", absent means "never interacted"
// (so untouched sections keep using their own defaultOpen prop).
const OPEN_SECTION_KEY = "crl6mans_admin_open_section";

interface AdminTabsState {
  isDesktop: boolean;
  activeTab: number;
  setActiveTab: (i: number) => void;
  /** true once the persisted values below have been read from localStorage */
  hydrated: boolean;
  /** undefined = no persisted preference yet; "" = persisted "nothing open" */
  openSection: string | undefined;
  setOpenSection: (title: string) => void;
}

const AdminTabsContext = createContext<AdminTabsState>({
  isDesktop: false,
  activeTab: 0,
  setActiveTab: () => {},
  hydrated: false,
  openSection: undefined,
  setOpenSection: () => {},
});

export function useAdminTabs() {
  return useContext(AdminTabsContext);
}

export function AdminTabsProvider({ children }: { children: React.ReactNode }) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [activeTab, setActiveTabState] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [openSection, setOpenSectionState] = useState<string | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    setIsDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", onChange);

    const storedTab = localStorage.getItem(ACTIVE_TAB_KEY);
    if (storedTab !== null) {
      const n = Number(storedTab);
      if (Number.isInteger(n) && n >= 0) setActiveTabState(n);
    }
    const storedSection = localStorage.getItem(OPEN_SECTION_KEY);
    if (storedSection !== null) setOpenSectionState(storedSection);
    setHydrated(true);

    return () => mql.removeEventListener("change", onChange);
  }, []);

  const setActiveTab = (i: number) => {
    setActiveTabState(i);
    localStorage.setItem(ACTIVE_TAB_KEY, String(i));
  };

  const setOpenSection = (title: string) => {
    setOpenSectionState(title);
    localStorage.setItem(OPEN_SECTION_KEY, title);
  };

  return (
    <AdminTabsContext.Provider value={{ isDesktop, activeTab, setActiveTab, hydrated, openSection, setOpenSection }}>
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
