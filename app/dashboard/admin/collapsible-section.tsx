"use client";

import { useState } from "react";

interface Props {
  title: string;
  /** Plain count, not actionable — e.g. how many teams exist. Rendered grey. */
  value?: number;
  /** Something needs your attention — e.g. pending approvals. Rendered blue. */
  notification?: number;
  defaultOpen?: boolean;
  description?: string;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, value, notification, defaultOpen = true, description, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <div className="w-full flex items-center gap-3 mb-5 pb-3 border-b border-zinc-800">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 flex-1 text-left group min-w-0"
        >
          <h2 className="text-lg font-semibold text-white truncate min-w-0">{title}</h2>
          {description && (
            <span className="relative group/tip shrink-0 hidden md:inline-flex">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-zinc-600 group-hover/tip:text-zinc-400"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="11" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-72 max-w-[80vw] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-normal leading-relaxed text-zinc-300 opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100">
                {description}
              </span>
            </span>
          )}
          <span className="flex-1" />
          {!!value && (
            <span className="text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 px-2 py-0.5 rounded-full shrink-0">
              {value}
            </span>
          )}
          {!!notification && (
            <span className="text-xs font-medium bg-indigo-600 text-white px-2 py-0.5 rounded-full shrink-0">
              {notification}
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
