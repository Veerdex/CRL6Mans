"use client";

import type { RevokedPatron } from "./player-moderation-actions";

function formatPledge(patron: RevokedPatron): string {
  const tier = patron.tierTitle;
  const cents = patron.entitledCents;
  if (tier && cents) return `${tier} ($${(cents / 100).toFixed(2)}/mo)`;
  if (tier) return tier;
  if (cents) return `$${(cents / 100).toFixed(2)}/mo`;
  return "a free membership";
}

// The ban already stripped every benefit, the public listing and the stored
// Patreon tokens. What it cannot do is stop the money: Patreon's API is
// read-only for memberships, so the charge only ends when a director blocks
// them on Patreon itself. Saying so here is the difference between the admin
// knowing that and assuming the ban handled it.
export function PatreonBlockNotice({
  patron,
  onDismiss,
}: {
  patron: RevokedPatron;
  onDismiss: () => void;
}) {
  return (
    <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg p-3 space-y-2">
      <p className="text-xs text-amber-200">
        Supporter status revoked ({formatPledge(patron)}). They keep being charged until you block them on Patreon —
        that also cancels their membership and stops them rejoining.
      </p>
      <div className="flex items-center gap-3">
        <a
          href="https://www.patreon.com/members"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-2.5 py-1 rounded-md bg-amber-900/50 hover:bg-amber-900 border border-amber-700/50 text-amber-100 transition-colors"
        >
          Open Patreon members →
        </a>
        <button onClick={onDismiss} className="text-xs text-amber-400/70 hover:text-amber-300 transition-colors">
          Dismiss
        </button>
      </div>
    </div>
  );
}
