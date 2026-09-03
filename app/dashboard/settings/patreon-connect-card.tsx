"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPatreonPublic, disconnectPatreon } from "./patreon-actions";

export type PatreonInfo = {
  status: "active_patron" | "declined_patron" | "former_patron" | null;
  tierTitle: string | null;
  entitledCents: number | null;
  isPublic: boolean;
  linked: boolean;
  overrideTier: string | null;
} | null;

const STATUS_LABELS: Record<string, string> = {
  active_patron: "Active patron",
  declined_patron: "Payment declined",
  former_patron: "Former patron",
};

function formatCents(cents: number | null) {
  if (cents === null) return null;
  return `$${(cents / 100).toFixed(2)}/mo`;
}

export function PatreonConnectCard({ info, banner }: { info: PatreonInfo; banner?: string | null }) {
  const router = useRouter();
  const [isPublic, setIsPublic] = useState(info?.isPublic ?? false);
  const [, startToggle] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  function togglePublic() {
    const next = !isPublic;
    setIsPublic(next);
    startToggle(() => {
      setPatreonPublic(next);
    });
  }

  function handleDisconnect() {
    startDisconnect(async () => {
      await disconnectPatreon();
      router.refresh();
    });
  }

  return (
    <div className="p-4 bg-zinc-800 border border-zinc-700 rounded-lg space-y-3">
      <div>
        <p className="text-sm font-medium text-zinc-300">Patreon</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          {!info
            ? "Link your Patreon account to support the league."
            : info.linked
              ? "Your Patreon support is linked to this account."
              : "A director has pinned this account to a tier for testing."}
        </p>
      </div>

      {banner === "connected" && <p className="text-xs text-emerald-400">Patreon connected.</p>}
      {banner === "cancelled" && <p className="text-xs text-zinc-500">Patreon connection cancelled.</p>}
      {banner === "error" && <p className="text-xs text-red-400">Something went wrong connecting Patreon. Try again.</p>}

      {info ? (
        <div className="space-y-2 text-xs">
          <p className="text-zinc-300">
            {info.linked ? (
              <>
                {STATUS_LABELS[info.status ?? ""] ?? "Linked"}
                {info.tierTitle ? ` — ${info.tierTitle}` : ""}
                {formatCents(info.entitledCents) ? ` (${formatCents(info.entitledCents)})` : ""}
              </>
            ) : (
              `Tier override — ${info.overrideTier}`
            )}
          </p>
          <label className="flex items-center gap-2 text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={isPublic} onChange={togglePublic} className="accent-indigo-500" />
            Show me publicly on the Support Us page
          </label>
          {info.linked && (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-zinc-500 hover:text-red-400 underline transition-colors disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          )}
        </div>
      ) : (
        <a
          href="/api/auth/patreon"
          className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Connect Patreon
        </a>
      )}
    </div>
  );
}
