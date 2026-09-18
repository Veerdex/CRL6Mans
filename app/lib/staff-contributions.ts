import { cookies } from "next/headers";
import { decrypt } from "./session";
import { supabaseAdmin } from "./supabase";

// The qualifying set, in one place. The line every member of it shares: it is a
// decision about one player or one match that someone was waiting on. League
// configuration — creating a tournament or a season, opening signups, editing
// sponsors, flipping a settings toggle — is not adjudication and scores nothing,
// and neither does anything an admin could repeat at will to inflate a number.
export type StaffAction =
  | "registration_approved"
  | "registration_rejected"
  | "profile_change_approved"
  | "profile_change_rejected"
  | "platform_account_verified"
  | "platform_account_rejected"
  | "platform_account_corrected"
  | "platform_account_revoked"
  | "identity_discrepancy_resolved"
  | "game_identity_reverified"
  | "replay_review_approved"
  | "replay_review_rejected"
  | "schedule_override_approved"
  | "schedule_override_rejected"
  | "match_result_reported"
  | "team_disqualified"
  | "player_kicked"
  | "player_banned"
  | "player_unkicked"
  | "player_unbanned";

// Reads the actor from the session rather than taking one, so instrumenting an
// action is a single line with no signature change. Call it on the success path,
// after whatever guard proves the transition actually happened — every one of
// these is reachable twice by a double click, and an attempt is not a
// contribution.
export async function recordStaffAction(
  action: StaffAction,
  subjectId?: string | null,
): Promise<void> {
  try {
    const cookieStore = await cookies();
    const session = await decrypt(cookieStore.get("session")?.value);
    if (!session?.userId) return;

    // Gated on a stored staff_roles row, not getStaffRole() — that also resolves
    // DEVELOPER_DISCORD_IDS as CEO, and those IDs have no row, so they never
    // appear in Staff Management. Crediting them would write rows nothing can
    // ever display.
    const { data: staff } = await supabaseAdmin
      .from("staff_roles")
      .select("discord_id")
      .eq("discord_id", session.userId)
      .maybeSingle();
    if (!staff) return;

    await supabaseAdmin.from("staff_contributions").insert({
      discord_id: session.userId,
      action,
      subject_id: subjectId ?? null,
    });
  } catch {
    // A contribution is never worth failing the action that earned it.
  }
}

// One indexed count per staff member rather than one scan of the whole log:
// the staff list is tiny and bounded, the log is neither.
//
// Before the migration is run by hand the table is absent, and PostgREST's 404
// comes back through postgrest-js as count null with error also null — so both
// fallbacks below are load-bearing, and the section reads 0 rather than
// blanking. The cost is that "no rows yet" and "no table yet" look identical
// here; they display the same either way.
export async function getStaffContributionCounts(
  discordIds: string[],
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    discordIds.map(async (id) => {
      const { count, error } = await supabaseAdmin
        .from("staff_contributions")
        .select("id", { count: "exact", head: true })
        .eq("discord_id", id);
      return [id, error ? 0 : count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}
