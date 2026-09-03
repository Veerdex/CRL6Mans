"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBenefitEnabled, disconnectPatreon } from "./patreon-actions";

export type PatreonInfo = {
  status: "active_patron" | "declined_patron" | "former_patron" | null;
  tierTitle: string | null;
  entitledCents: number | null;
  linked: boolean;
  overrideTier: string | null;
} | null;

// One row per benefit the account's tier grants, resolved server-side so the
// client never decides entitlement.
export type PatreonBenefitRow = {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  active_patron: "Active patron",
  declined_patron: "Payment declined",
  former_patron: "Former patron",
};

function formatCents(cents: number | null) {
  if (cents === null) return null;
  return `$${(cents / 100).toFixed(2)}/mo`;
}

export function PatreonConnectCard({
  info,
  benefits,
  banner,
}: {
  info: PatreonInfo;
  benefits: PatreonBenefitRow[];
  banner?: string | null;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(benefits.map((b) => [b.id, b.enabled])),
  );
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [pending, startToggle] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  const offCount = benefits.filter((b) => !enabled[b.id]).length;

  function toggle(id: string) {
    const next = !enabled[id];
    setEnabled((prev) => ({ ...prev, [id]: next }));
    // Several benefits render in server-rendered chrome (the supporter badge in
    // the dashboard layout, the Support Us list), so the switch only takes
    // visible effect after a refresh.
    startToggle(async () => {
      await setBenefitEnabled(id, next);
      router.refresh();
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

      {banner === "connected" && (
        <p className="text-xs text-emerald-400">
          Patreon connected.
          {benefits.length > 0 &&
            " Your benefits start switched off — turn on the ones you want below."}
        </p>
      )}
      {banner === "cancelled" && <p className="text-xs text-zinc-500">Patreon connection cancelled.</p>}
      {banner === "error" && (
        <p className="text-xs text-red-400">Something went wrong connecting Patreon. Try again.</p>
      )}

      {info ? (
        <div className="space-y-3 text-xs">
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

          <div className="space-y-2">
            <p className="text-zinc-400 font-medium">Your benefits</p>

            {benefits.length === 0 ? (
              <p className="text-zinc-500">No benefits are assigned to your tier yet.</p>
            ) : (
              <>
                {offCount > 0 && (
                  <p className="text-amber-400">
                    {offCount === benefits.length
                      ? "None of your benefits are turned on yet — they are off by default. Enable the ones you want below."
                      : `${offCount} of your benefits ${offCount === 1 ? "is" : "are"} still turned off.`}
                  </p>
                )}

                {benefits.map((b) => (
                  <div key={b.id} className="px-3 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-zinc-300 truncate">{b.title}</span>
                        <button
                          type="button"
                          onClick={() => setOpenInfo(openInfo === b.id ? null : b.id)}
                          aria-expanded={openInfo === b.id}
                          aria-label={`What is ${b.title}?`}
                          className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full border border-zinc-600 text-zinc-400 text-[11px] font-semibold hover:text-zinc-200 hover:border-zinc-400 transition-colors"
                        >
                          i
                        </button>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={!!enabled[b.id]}
                          onChange={() => toggle(b.id)}
                          disabled={pending}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-zinc-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-pure-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 peer-disabled:opacity-50" />
                      </label>
                    </div>
                    {openInfo === b.id && <p className="text-zinc-500 mt-2">{b.description}</p>}
                  </div>
                ))}
              </>
            )}
          </div>

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
