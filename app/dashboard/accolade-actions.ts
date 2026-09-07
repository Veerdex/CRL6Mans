"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { fetchAccoladePrizes } from "@/app/lib/season-accolades";
import {
  ACCOLADE_KEYS,
  accoladeMeta,
  isAccoladeKey,
  type AccoladeKey,
} from "@/app/lib/accolades";

export type AccoladeHolder = {
  discordId: string;
  username: string;
  displayName: string | null;
};

export type AccoladeSlot = {
  key: AccoladeKey;
  prize: number;
  holder: AccoladeHolder | null;
};

export type AccoladeState = { slots: AccoladeSlot[] };
export type AccoladeResult = AccoladeState | { error: string };

const DENIED = "Only Directors can award season accolades.";

/**
 * Director+ only — a moderator can moderate players but cannot decide who holds
 * a season's accolades. Returns null rather than redirecting so the caller can
 * surface the refusal inside the popup the click came from.
 */
async function directorId(): Promise<string | null> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");
  return (await isDirectorVerified(session.userId)) ? session.userId : null;
}

async function readState(seasonId: string): Promise<AccoladeState> {
  const [{ data: awardRows, error }, prizeMap] = await Promise.all([
    supabaseAdmin
      .from("season_accolades")
      .select("accolade, discord_id")
      .eq("season_id", seasonId),
    fetchAccoladePrizes([seasonId]),
  ]);
  if (error) throw new Error(error.message);

  const awards = (awardRows ?? []) as { accolade: AccoladeKey; discord_id: string }[];
  const prizes = prizeMap.get(seasonId);

  const holderIds = [...new Set(awards.map((a) => a.discord_id))];
  const holders = new Map<string, AccoladeHolder>();
  if (holderIds.length) {
    const { data: accounts } = await supabaseAdmin
      .from("accounts")
      .select("discord_id, username, display_name")
      .in("discord_id", holderIds);
    for (const a of (accounts ?? []) as {
      discord_id: string;
      username: string;
      display_name: string | null;
    }[]) {
      holders.set(a.discord_id, {
        discordId: a.discord_id,
        username: a.username,
        displayName: a.display_name,
      });
    }
  }

  return {
    slots: ACCOLADE_KEYS.map((key) => {
      const award = awards.find((a) => a.accolade === key);
      return {
        key,
        prize: prizes?.[key] ?? 0,
        holder: award
          ? holders.get(award.discord_id) ?? {
              // An award whose account has since been deleted still shows as
              // taken, so a Director can see why the slot is occupied.
              discordId: award.discord_id,
              username: award.discord_id,
              displayName: null,
            }
          : null,
      };
    }),
  };
}

export async function getSeasonAccolades(seasonId: string): Promise<AccoladeResult> {
  if (!(await directorId())) return { error: DENIED };
  return readState(seasonId);
}

/**
 * Toggle one accolade onto a player for one season.
 *
 * Holding it already means the click removes it; someone else holding it means
 * the click takes it from them. Either way the incumbent row is deleted before
 * the new one is written — PostgREST has no transaction, and a failure halfway
 * through must leave the accolade unassigned rather than duplicated.
 */
export async function setSeasonAccolade(
  seasonId: string,
  accolade: string,
  discordId: string,
): Promise<AccoladeResult> {
  const actor = await directorId();
  if (!actor) return { error: DENIED };
  if (!isAccoladeKey(accolade)) return { error: "Unknown accolade." };

  // Seasons only, and only for a season the player actually played in — the
  // client's dropdown is filtered, but the list is not the guard.
  const { data: participation } = await supabaseAdmin
    .from("player_event_results")
    .select("event_id")
    .eq("event_kind", "season")
    .eq("event_id", seasonId)
    .eq("discord_id", discordId)
    .maybeSingle();
  if (!participation) return { error: "That player did not play in this season." };

  const { data: existing } = await supabaseAdmin
    .from("season_accolades")
    .select("discord_id")
    .eq("season_id", seasonId)
    .eq("accolade", accolade)
    .maybeSingle();

  const { error: deleteError } = await supabaseAdmin
    .from("season_accolades")
    .delete()
    .eq("season_id", seasonId)
    .eq("accolade", accolade);
  if (deleteError) return { error: deleteError.message };

  const alreadyHeld = (existing as { discord_id: string } | null)?.discord_id === discordId;
  if (!alreadyHeld) {
    const { error: insertError } = await supabaseAdmin.from("season_accolades").insert({
      season_id: seasonId,
      accolade,
      discord_id: discordId,
      awarded_by: actor,
    });
    if (insertError) return { error: insertError.message };
  }

  return readState(seasonId);
}

/**
 * The four prize values for one archived season. Editable after completion
 * because the backfilled seasons were written by a script that had no such
 * field, and because points are recomputed from the prize on every read — so a
 * corrected value corrects whoever holds the accolade.
 */
export async function saveSeasonAccoladePrizes(
  seasonId: string,
  prizes: Record<string, number | null>,
): Promise<AccoladeResult> {
  if (!(await directorId())) return { error: DENIED };

  const update: Record<string, number | null> = {};
  for (const key of ACCOLADE_KEYS) {
    const raw = prizes[key];
    if (raw === null || raw === undefined || Number.isNaN(raw)) {
      update[accoladeMeta(key).prizeColumn] = null;
      continue;
    }
    if (!Number.isInteger(raw) || raw < 0) {
      return { error: "Accolade values must be non-negative whole numbers." };
    }
    update[accoladeMeta(key).prizeColumn] = raw === 0 ? null : raw;
  }

  const { error } = await supabaseAdmin.from("seasons").update(update).eq("id", seasonId);
  if (error) return { error: error.message };

  return readState(seasonId);
}
