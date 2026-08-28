"use client";

import { useState, useTransition } from "react";
import {
  createBenefit,
  updateBenefit,
  deleteBenefit,
  createTier,
  updateTier,
  deleteTier,
  type Benefit,
  type BenefitInput,
  type Tier,
  type TierInput,
} from "./patreon-tiers-actions";
import { PatreonBenefitModal } from "./patreon-benefit-modal";
import { PatreonTierModal } from "./patreon-tier-modal";

function DeletableRow({
  title,
  subtitle,
  onEdit,
  onDelete,
  isPending,
}: {
  title: string;
  subtitle?: string;
  onEdit: () => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="border border-zinc-800 rounded-xl p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-white">{title}</span>
      </div>
      {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onEdit}
          className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          Edit
        </button>
        {confirming ? (
          <>
            <button onClick={onDelete} disabled={isPending} className="text-xs text-red-400 underline disabled:opacity-40">
              Confirm
            </button>
            <button onClick={() => setConfirming(false)} className="text-xs text-zinc-500 underline">
              Cancel
            </button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:text-red-400 transition-colors">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function BenefitsPanel({ benefits }: { benefits: Benefit[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Benefit | null | "new">(null);

  async function handleSave(input: BenefitInput) {
    const res = editing && editing !== "new" ? await updateBenefit(editing.id, input) : await createBenefit(input);
    if (res.error) return { error: res.error };
    return {};
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteBenefit(id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-white">Benefits</p>
        <p className="text-xs text-zinc-500">The perk catalog. Name + description so it&apos;s clear what each one does when assigning it to a tier below.</p>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {benefits.length === 0 ? (
        <p className="text-xs text-zinc-600">No benefits yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {benefits.map((b) => (
            <DeletableRow
              key={b.id}
              title={b.name}
              subtitle={b.description}
              onEdit={() => setEditing(b)}
              onDelete={() => handleDelete(b.id)}
              isPending={isPending}
            />
          ))}
        </div>
      )}

      <button onClick={() => setEditing("new")} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
        + New benefit
      </button>

      {editing && (
        <PatreonBenefitModal benefit={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={handleSave} />
      )}
    </div>
  );
}

function TiersPanel({ tiers, benefits, liveTierTitles }: { tiers: Tier[]; benefits: Benefit[]; liveTierTitles: string[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Tier | null | "new">(null);
  const benefitById = new Map(benefits.map((b) => [b.id, b]));

  async function handleSave(input: TierInput) {
    const res = editing && editing !== "new" ? await updateTier(editing.id, input) : await createTier(input);
    if (res.error) return { error: res.error };
    return {};
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteTier(id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-white">Tiers</p>
        <p className="text-xs text-zinc-500">Hand-designed tiers — name them to match your real Patreon tiers, then pick which benefits each one includes.</p>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {tiers.length === 0 ? (
        <p className="text-xs text-zinc-600">No tiers yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tiers.map((t) => (
            <div key={t.id} className="border border-zinc-800 rounded-xl p-3 space-y-1.5">
              <span className="text-sm font-medium text-white">{t.name}</span>
              <p className="text-xs text-zinc-500">{t.description}</p>
              {t.benefitIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {t.benefitIds.map((id) => {
                    const b = benefitById.get(id);
                    if (!b) return null;
                    return (
                      <span key={id} className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                        {b.name}
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setEditing(t)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Edit
                </button>
                <TierDeleteButton isPending={isPending} onDelete={() => handleDelete(t.id)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setEditing("new")} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
        + New tier
      </button>

      {editing && (
        <PatreonTierModal
          tier={editing === "new" ? null : editing}
          benefits={benefits}
          liveTierTitles={liveTierTitles}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function TierDeleteButton({ isPending, onDelete }: { isPending: boolean; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <>
        <button onClick={onDelete} disabled={isPending} className="text-xs text-red-400 underline disabled:opacity-40">
          Confirm
        </button>
        <button onClick={() => setConfirming(false)} className="text-xs text-zinc-500 underline">
          Cancel
        </button>
      </>
    );
  }
  return (
    <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:text-red-400 transition-colors">
      Delete
    </button>
  );
}

export function PatreonTiersSection({
  tiers,
  benefits,
  liveTierTitles,
}: {
  tiers: Tier[];
  benefits: Benefit[];
  liveTierTitles: string[];
}) {
  return (
    <div className="space-y-8">
      <BenefitsPanel benefits={benefits} />
      <TiersPanel tiers={tiers} benefits={benefits} liveTierTitles={liveTierTitles} />
    </div>
  );
}
