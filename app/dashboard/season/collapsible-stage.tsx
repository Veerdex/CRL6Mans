"use client";

import { useState } from "react";

interface Props {
  title: string;
  controls?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleStage({ title, controls, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 group"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            className={`text-zinc-600 group-hover:text-zinc-400 transition-all duration-200 shrink-0 ${open ? "rotate-0" : "-rotate-90"}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <h2 className="text-sm font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">
            {title}
          </h2>
        </button>
        {controls}
      </div>
      {open && children}
    </div>
  );
}
