"use client";

import { useState } from "react";

interface Props {
  title: string;
  badge?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, badge, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <div className="w-full flex items-center gap-3 mb-5 pb-3 border-b border-zinc-800">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-3 flex-1 text-left group min-w-0"
        >
          <h2 className="text-lg font-semibold text-white flex-1 truncate">{title}</h2>
          {!!badge && (
            <span className="text-xs font-medium bg-indigo-600 text-white px-2 py-0.5 rounded-full shrink-0">
              {badge}
            </span>
          )}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-zinc-500 group-hover:text-zinc-300 transition-transform duration-200 shrink-0 ${open ? "rotate-0" : "-rotate-90"}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {open && children}
    </section>
  );
}
