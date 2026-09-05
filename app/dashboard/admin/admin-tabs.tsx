"use client";

import { createContext, useContext, useEffect, useState } from "react";

// The sidebar+tabs layout is a desktop-only navigation layer — on mobile every
// panel still renders in original order as one long list, exactly as it
// worked before this feature existed.
const DESKTOP_QUERY = "(min-width: 768px)";

const ACTIVE_SECTION_KEY = "crl6mans_admin_active_section";
const ACTIVE_SUBTAB_KEY = "crl6mans_admin_active_subtab";
// Title of the last mobile panel the admin explicitly opened or closed — ""
// means "explicitly none open", absent means "never interacted" (so untouched
// panels keep using their own defaultOpen prop).
const OPEN_MOBILE_PANEL_KEY = "crl6mans_admin_open_mobile_panel";

// Minimum staff rank that may see a tab. The page filters SECTIONS by this and
// drops any section left with no visible tabs, so a moderator never sees a
// dropdown whose contents are all above them.
export type AccessLevel = "moderator" | "director" | "ceo";

export const ACCESS_RANK: Record<AccessLevel, number> = { moderator: 1, director: 2, ceo: 3 };
export const ACCESS_LABEL: Record<AccessLevel, string> = {
  moderator: "Moderator +",
  director: "Director +",
  ceo: "CEO",
};

export interface SidebarSubTab {
  id: string;
  label: string;
  level: AccessLevel;
  value?: number;
  notification?: number;
}
export interface SidebarSection {
  id: string;
  label: string;
  subTabs: SidebarSubTab[];
}

const tabKey = (sectionId: string, tabId: string) => `${sectionId}:${tabId}`;

interface AdminNavState {
  isDesktop: boolean;
  hydrated: boolean;
  activeSection: string;
  setActiveSection: (id: string) => void;
  activeSubTabBySection: Record<string, string>;
  setActiveSubTab: (sectionId: string, tabId: string) => void;
  /** undefined = no persisted preference yet; "" = persisted "nothing open" */
  openMobilePanel: string | undefined;
  setOpenMobilePanel: (title: string) => void;
  /** Keyed by `sectionId:tabId` — drives the "(Director +)" suffix on panel headings. */
  levelByTab: Record<string, AccessLevel>;
}

const AdminNavContext = createContext<AdminNavState>({
  isDesktop: false,
  hydrated: false,
  activeSection: "",
  setActiveSection: () => {},
  activeSubTabBySection: {},
  setActiveSubTab: () => {},
  openMobilePanel: undefined,
  setOpenMobilePanel: () => {},
  levelByTab: {},
});

export function useAdminNav() {
  return useContext(AdminNavContext);
}

export function AdminTabsProvider({ sections, children }: { sections: SidebarSection[]; children: React.ReactNode }) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [activeSection, setActiveSectionState] = useState(sections[0]?.id ?? "");
  const [activeSubTabBySection, setActiveSubTabBySectionState] = useState<Record<string, string>>({});
  const [openMobilePanel, setOpenMobilePanelState] = useState<string | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    setIsDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", onChange);

    // Persisted selections are dropped when they name a section or tab this
    // admin cannot see — a demoted director would otherwise restore a hidden tab
    // and land on a blank content area.
    const visibleSections = new Set(sections.map((s) => s.id));
    const visibleTabs = new Set(sections.flatMap((s) => s.subTabs.map((t) => tabKey(s.id, t.id))));

    const storedSection = localStorage.getItem(ACTIVE_SECTION_KEY);
    if (storedSection && visibleSections.has(storedSection)) setActiveSectionState(storedSection);

    const storedSubTabs = localStorage.getItem(ACTIVE_SUBTAB_KEY);
    if (storedSubTabs) {
      try {
        const parsed = JSON.parse(storedSubTabs) as Record<string, string>;
        setActiveSubTabBySectionState(
          Object.fromEntries(Object.entries(parsed).filter(([sectionId, tabId]) => visibleTabs.has(tabKey(sectionId, tabId)))),
        );
      } catch {
        /* ignore malformed persisted state */
      }
    }

    const storedPanel = localStorage.getItem(OPEN_MOBILE_PANEL_KEY);
    if (storedPanel !== null) setOpenMobilePanelState(storedPanel);

    setHydrated(true);
    return () => mql.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const levelByTab: Record<string, AccessLevel> = {};
  for (const sec of sections) {
    for (const t of sec.subTabs) levelByTab[tabKey(sec.id, t.id)] = t.level;
  }

  const setActiveSection = (id: string) => {
    setActiveSectionState(id);
    localStorage.setItem(ACTIVE_SECTION_KEY, id);
  };

  const setActiveSubTab = (sectionId: string, tabId: string) => {
    setActiveSubTabBySectionState((prev) => {
      const next = { ...prev, [sectionId]: tabId };
      localStorage.setItem(ACTIVE_SUBTAB_KEY, JSON.stringify(next));
      return next;
    });
  };

  const setOpenMobilePanel = (title: string) => {
    setOpenMobilePanelState(title);
    localStorage.setItem(OPEN_MOBILE_PANEL_KEY, title);
  };

  return (
    <AdminNavContext.Provider
      value={{
        isDesktop,
        hydrated,
        activeSection,
        setActiveSection,
        activeSubTabBySection,
        setActiveSubTab,
        openMobilePanel,
        setOpenMobilePanel,
        levelByTab,
      }}
    >
      {children}
    </AdminNavContext.Provider>
  );
}

function Badge({ value, notification }: { value?: number; notification?: number }) {
  if (notification) {
    return (
      <span className="text-xs font-medium bg-indigo-600 text-white px-2 py-0.5 rounded-full shrink-0">
        {notification}
      </span>
    );
  }
  if (value) {
    return (
      <span className="text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 px-2 py-0.5 rounded-full shrink-0">
        {value}
      </span>
    );
  }
  return null;
}

// Sidebar section list. Clicking a section expands it in place — revealing its
// tabs indented underneath — and collapses whichever other section was open,
// since only one `activeSection` value can ever be true at a time.
export function AdminSidebar({ sections }: { sections: SidebarSection[] }) {
  const { isDesktop, activeSection, setActiveSection, activeSubTabBySection, setActiveSubTab } = useContext(AdminNavContext);

  if (!isDesktop) return null;

  function selectSection(sec: SidebarSection) {
    setActiveSection(sec.id);
    if (!activeSubTabBySection[sec.id] && sec.subTabs[0]) {
      setActiveSubTab(sec.id, sec.subTabs[0].id);
    }
  }

  return (
    <nav className="hidden md:block w-60 shrink-0 space-y-1">
      {sections.map((sec) => {
        const expanded = sec.id === activeSection;
        const activeSub = activeSubTabBySection[sec.id] ?? sec.subTabs[0]?.id;
        const sectionValue = sec.subTabs.reduce((n, t) => n + (t.value ?? 0), 0);
        const sectionNotification = sec.subTabs.reduce((n, t) => n + (t.notification ?? 0), 0);
        return (
          <div key={sec.id}>
            <button
              onClick={() => selectSection(sec)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                expanded ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
              }`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
              >
                <polyline points="9 6 15 12 9 18" />
              </svg>
              <span className="flex-1 truncate">{sec.label}</span>
              <Badge value={sectionValue} notification={sectionNotification} />
            </button>
            {expanded && (
              <div className="ml-4 mt-1 pl-3 border-l border-zinc-800 space-y-0.5">
                {sec.subTabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveSubTab(sec.id, t.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-left transition-colors ${
                      activeSub === t.id ? "bg-indigo-600/20 text-white" : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    <span className="flex-1 truncate">{t.label}</span>
                    <Badge value={t.value} notification={t.notification} />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// Gates a top-level section's content to when it's the sidebar's active section.
// On mobile every section renders (no gating), matching AdminSidebar returning null.
export function AdminSection({ id, children }: { id: string; children: React.ReactNode }) {
  const { isDesktop, activeSection } = useContext(AdminNavContext);
  if (isDesktop && activeSection !== id) return null;
  return <>{children}</>;
}
