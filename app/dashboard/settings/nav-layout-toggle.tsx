"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setNavLayout, type NavLayout } from "./nav-layout-actions";

const OPTIONS: { value: NavLayout; label: string }[] = [
  { value: "sidebar", label: "Sidebar" },
  { value: "topbar", label: "Top & Bottom" },
];

export function NavLayoutToggle({ initial }: { initial: NavLayout }) {
  const router = useRouter();
  const [layout, setLayout] = useState<NavLayout>(initial);
  const [pending, startTransition] = useTransition();

  const choose = (next: NavLayout) => {
    if (next === layout || pending) return;
    setLayout(next);
    startTransition(async () => {
      await setNavLayout(next);
      router.refresh(); // layout chrome is server-rendered — re-fetch to apply
    });
  };

  // Desktop-only: the alternate layout doesn't apply on mobile.
  return (
    <div className="hidden md:flex items-center justify-between gap-4 p-4 bg-zinc-800 border border-zinc-700 rounded-lg">
      <div>
        <p className="text-sm font-medium text-zinc-300">Navigation layout</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          Sidebar, or tabs across the top with a bottom bar. Desktop only.
        </p>
      </div>
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded-lg p-1 shrink-0">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => choose(o.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              layout === o.value ? "bg-indigo-600 text-on-accent" : "text-zinc-400 hover:text-white"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
