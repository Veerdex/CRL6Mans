"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  href: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
  // Tighter spacing for icon-only tabs. A prop rather than a className override:
  // Tailwind picks the winner by stylesheet order, so a gap/padding passed
  // through className loses to the base scale below no matter how it's ordered.
  compact?: boolean;
};

export default function NavLink({ href, children, className = "", title, compact = false }: Props) {
  const pathname = usePathname();
  const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      title={title}
      className={`flex items-center py-2 rounded-lg text-sm font-medium transition-colors ${
        compact ? "gap-1.5 px-2" : "gap-3 px-3"
      } ${className} ${
        active
          ? "bg-zinc-800 text-white"
          : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"
      }`}
    >
      {children}
    </Link>
  );
}
