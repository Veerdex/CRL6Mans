"use client";

import { useState } from "react";

export type PreviewTier = { title: string; rank: number; cents: number; benefitIds: string[] };
export type PreviewBenefit = { id: string; title: string; description: string; alwaysOn: boolean };

function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

// The tier panels below this button only exist for tiers granting
// featured-on-support-page, so the benefit list can't live inside them — a
// director unassigning that one benefit would take the whole explanation with
// it. A modal also escapes the page's max-w-2xl, which is what makes a
// tier-per-card grid readable at all.
//
// Cards carry benefit titles only and the descriptions appear once each in the
// legend below, because tiers inherit downward: repeating every description in
// every card would print the cheapest tier's benefits three times over.
export function BenefitsPreview({ tiers, benefits }: { tiers: PreviewTier[]; benefits: PreviewBenefit[] }) {
  const [open, setOpen] = useState(false);
  const byId = new Map(benefits.map((b) => [b.id, b]));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-6 py-3 border border-zinc-600 hover:border-zinc-400 hover:bg-zinc-800 text-zinc-200 text-sm font-semibold rounded-lg transition-colors"
      >
        See what you get
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-3xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-800 bg-zinc-900">
              <h2 className="text-lg font-semibold text-white">What each tier gets</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-lg leading-none text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                &times;
              </button>
            </div>

            <div className="p-5 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {tiers.map((tier) => (
                  <div key={tier.title} className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-4 space-y-3">
                    <div>
                      <p className="font-semibold text-zinc-100">{tier.title}</p>
                      <p className="text-xs text-zinc-400">
                        {formatPrice(tier.cents)}/month · Tier {tier.rank}
                      </p>
                    </div>
                    <ul className="space-y-1.5">
                      {tier.benefitIds.map((id) => (
                        <li key={id} className="flex items-start gap-2 text-sm text-zinc-300">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="mt-1 shrink-0 text-indigo-400"
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                          <span>
                            {byId.get(id)?.title}
                            {byId.get(id)?.alwaysOn && (
                              <span className="ml-1.5 align-middle text-[0.65rem] uppercase tracking-wide text-zinc-500">
                                Included
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">What these mean</p>
                <dl className="space-y-3">
                  {benefits.map((benefit) => (
                    <div key={benefit.id}>
                      <dt className="text-sm font-medium text-zinc-200">{benefit.title}</dt>
                      <dd className="text-sm text-zinc-400">{benefit.description}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <p className="text-xs text-zinc-500 border-t border-zinc-800 pt-4">
                Each tier includes everything from the tiers below it. Benefits start switched off — turn on the ones
                you want in Settings after you pledge. Ones marked Included come with the tier, with nothing to turn
                on.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
