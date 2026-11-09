import type { MemberView } from "@/app/lib/fantasy-leagues";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";

/** The league's waiver priority, highest first, as a strip of numbered chips. */
export function WaiverOrder({
  order,
  members,
  viewerId,
}: {
  order: string[];
  members: MemberView[];
  viewerId: string | null;
}) {
  if (order.length === 0) return null;
  const byId = new Map(members.map((m) => [m.accountId, m]));
  return (
    <section aria-labelledby="waiver-order-heading" className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="waiver-order-heading" className="text-sm font-semibold text-white">
          Waiver order
        </h2>
        <p className="text-xs text-zinc-400">
          Claims go top down. After each run, managers who won a claim drop to the back, the highest furthest.
        </p>
      </div>
      <ol className="flex flex-wrap gap-1.5">
        {order.map((id, i) => {
          const m = byId.get(id);
          const you = id === viewerId;
          return (
            <li
              key={id}
              aria-current={you ? "true" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-2.5 text-xs ${
                you ? "border-indigo-500 bg-indigo-500/15 font-semibold text-white" : "border-zinc-700 bg-zinc-900 text-zinc-300"
              }`}
            >
              <span className="w-4 text-center tabular-nums text-zinc-400">{i + 1}</span>
              {m && <PlayerAvatar discordId={m.discordId} avatar={m.avatar} username={m.username ?? m.name} className="w-4 h-4" cdnSize={32} />}
              {you ? "You" : m?.name ?? "Unknown"}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
