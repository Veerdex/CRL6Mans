"use client";

import { useEffect, useState } from "react";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "starting now";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  if (days || hours || minutes) parts.push(`${minutes}m`);
  if (!days) parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function CountdownLabel({ label, iso, className }: { label: string; iso: string; className?: string }) {
  const target = new Date(iso).getTime();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(target - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  return (
    <p className={className ?? "text-[21px] font-semibold text-yellow-400"}>
      <span className="font-normal opacity-80">{label}</span>
      {remaining !== null && <span className="font-bold"> in {formatRemaining(remaining)}</span>}
    </p>
  );
}
