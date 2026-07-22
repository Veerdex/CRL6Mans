"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isCEOVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getGuildChannels, deleteChannel } from "@/app/lib/discord-api";
import { createMatchChannel } from "@/app/lib/discord-bot";

async function verifyCEO() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isCEOVerified(session.userId))) redirect("/dashboard");
  return session;
}

export type ChannelAuditItem = {
  channelName: string;
  discordChannelId: string | null;
  matchId: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  stage: string | null;
  round: number | null;
  status: "ok" | "missing_tracked" | "missing_untracked" | "extra";
};

export type ChannelAuditResult = {
  items: ChannelAuditItem[];
  error?: string;
};

export async function auditMatchChannels(): Promise<ChannelAuditResult> {
  await verifyCEO();

  try {
    const [{ data: allMatches }, { data: ls }, { data: cats }] = await Promise.all([
      supabaseAdmin
        .from("matches")
        .select("id, stage, round, status, discord_channel_id, home_team_id, away_team_id, home_checked_in, away_checked_in"),
      supabaseAdmin.from("league_settings").select("active_tournament_id").single(),
      supabaseAdmin.from("match_discord_categories").select("discord_category_id"),
    ]);

    const isTournamentMode = !!(ls?.active_tournament_id as string | null | undefined);
    const catIds = new Set((cats ?? []).map((c) => c.discord_category_id as string));

    const { data: schedules } = isTournamentMode
      ? { data: [] as { stage: string; round: number }[] }
      : await supabaseAdmin
          .from("round_schedules")
          .select("stage, round")
          .is("tournament_id", null);
    const scheduleSet = new Set((schedules ?? []).map((s) => `${s.stage}:${s.round}`));

    const matches = allMatches ?? [];

    const blockedByEarlierRound = (m: (typeof matches)[number]) => {
      const check = (teamId: string) =>
        matches.some(
          (x) =>
            x.stage === m.stage &&
            (x.round as number) < (m.round as number) &&
            x.status === "scheduled" &&
            (x.home_team_id === teamId || x.away_team_id === teamId),
        );
      return check(m.home_team_id!) || check(m.away_team_id!);
    };

    const trackedMatches = matches.filter((m) => m.discord_channel_id);
    const neverCreatedEligible = matches.filter((m) => {
      if (m.status !== "scheduled" || m.discord_channel_id || !m.home_team_id || !m.away_team_id) return false;
      if (blockedByEarlierRound(m)) return false;
      if (isTournamentMode) return !!m.home_checked_in && !!m.away_checked_in;
      const stageKey = (m.stage as string).startsWith("group_")
        ? "group"
        : (m.stage as string);
      return scheduleSet.has(`${stageKey}:${m.round}`);
    });

    // Load team names
    const teamIds = [
      ...new Set(
        [...trackedMatches, ...neverCreatedEligible].flatMap((m) =>
          [m.home_team_id, m.away_team_id].filter(Boolean) as string[],
        ),
      ),
    ];
    const { data: teamsData } = teamIds.length
      ? await supabaseAdmin.from("teams").select("id, name").in("id", teamIds)
      : { data: [] as { id: string; name: string }[] };
    const teamName = Object.fromEntries((teamsData ?? []).map((t) => [t.id, t.name]));

    const discordChannels = await getGuildChannels();

    // Heuristic: if we have categories tracked but Discord returned nothing,
    // bot likely lacks Manage Channels permission.
    if (discordChannels.length === 0 && catIds.size > 0) {
      return {
        items: [],
        error:
          "Bot could not fetch Discord channels. Verify it has the Manage Channels and View Channel permissions.",
      };
    }

    const discordById = new Map(discordChannels.map((c) => [c.id, c]));
    const trackedChannelIds = new Set(trackedMatches.map((m) => m.discord_channel_id as string));

    const items: ChannelAuditItem[] = [];

    for (const m of trackedMatches) {
      const channelId = m.discord_channel_id as string;
      const home = m.home_team_id ? (teamName[m.home_team_id] ?? null) : null;
      const away = m.away_team_id ? (teamName[m.away_team_id] ?? null) : null;
      const existing = discordById.get(channelId);
      const channelName =
        existing?.name ??
        (home && away
          ? `${home}-vs-${away}`.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 100)
          : channelId);
      items.push({
        channelName,
        discordChannelId: channelId,
        matchId: m.id,
        homeTeam: home,
        awayTeam: away,
        stage: m.stage as string | null,
        round: m.round as number | null,
        status: existing ? "ok" : "missing_tracked",
      });
    }

    for (const m of neverCreatedEligible) {
      const home = m.home_team_id ? (teamName[m.home_team_id] ?? null) : null;
      const away = m.away_team_id ? (teamName[m.away_team_id] ?? null) : null;
      const channelName =
        home && away
          ? `${home}-vs-${away}`.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 100)
          : m.id;
      items.push({
        channelName,
        discordChannelId: null,
        matchId: m.id,
        homeTeam: home,
        awayTeam: away,
        stage: m.stage as string | null,
        round: m.round as number | null,
        status: "missing_untracked",
      });
    }

    // Extra: Discord channels under a tracked match category that aren't tracked to any match
    for (const c of discordChannels) {
      if (c.parent_id && catIds.has(c.parent_id) && !trackedChannelIds.has(c.id)) {
        items.push({
          channelName: c.name,
          discordChannelId: c.id,
          matchId: null,
          homeTeam: null,
          awayTeam: null,
          stage: null,
          round: null,
          status: "extra",
        });
      }
    }

    return { items };
  } catch (err) {
    return { items: [], error: `Audit failed: ${String(err)}` };
  }
}

export async function applyChannelChanges(): Promise<{
  ok: boolean;
  message: string;
  created: number;
  deleted: number;
}> {
  await verifyCEO();

  try {
    const audit = await auditMatchChannels();
    if (audit.error) return { ok: false, message: audit.error, created: 0, deleted: 0 };

    const toCreate = audit.items.filter(
      (i) => i.status === "missing_tracked" || i.status === "missing_untracked",
    );
    const toDelete = audit.items.filter((i) => i.status === "extra");

    let created = 0;
    let deleted = 0;
    const errors: string[] = [];

    // Delete extra channels
    await Promise.all(
      toDelete.map(async (item) => {
        if (!item.discordChannelId) return;
        const ok = await deleteChannel(item.discordChannelId);
        if (ok) deleted++;
        else errors.push(`Failed to delete #${item.channelName}`);
      }),
    );

    // Recreate or create missing channels
    for (const item of toCreate) {
      if (!item.matchId || !item.homeTeam || !item.awayTeam) {
        errors.push(`Skipped ${item.channelName}: missing match data`);
        continue;
      }

      const { data: match } = await supabaseAdmin
        .from("matches")
        .select("id, stage, round, home_team_id, away_team_id, scheduled_at, admin_scheduled")
        .eq("id", item.matchId)
        .single();

      if (!match) {
        errors.push(`Skipped #${item.channelName}: match not found`);
        continue;
      }

      // For tracked-missing: clear the stale channel ID so the name-dedup check in
      // createMatchChannel can do its job and the new ID gets written to the match row.
      if (item.status === "missing_tracked" && item.discordChannelId) {
        await supabaseAdmin
          .from("matches")
          .update({ discord_channel_id: null })
          .eq("id", item.matchId);
      }

      const result = await createMatchChannel(
        item.homeTeam,
        item.awayTeam,
        match.round as number,
        undefined,
        {
          round: match.round as number,
          stage: match.stage as string,
          homeTeamId: match.home_team_id as string,
          awayTeamId: match.away_team_id as string,
          matchId: match.id as string,
          scheduledAt: (match.scheduled_at as string | null) ?? null,
          adminScheduled: (match.admin_scheduled as boolean | null) ?? false,
        },
      );

      if (result.created) created++;
      else if (result.skipped) {
        // Channel already exists by name — update the DB reference if we cleared it
        if (item.status === "missing_tracked") {
          errors.push(`#${item.channelName} already exists in Discord by name — DB reference updated`);
        }
      } else {
        errors.push(`Failed to create #${item.channelName}${result.error ? `: ${result.error}` : ""}`);
      }
    }

    const parts: string[] = [];
    if (created > 0) parts.push(`Created ${created} channel${created !== 1 ? "s" : ""}`);
    if (deleted > 0) parts.push(`Deleted ${deleted} channel${deleted !== 1 ? "s" : ""}`);
    if (created === 0 && deleted === 0 && errors.length === 0) parts.push("No changes needed");

    const base = parts.join(", ") + (parts.length ? "." : "");
    const message = errors.length ? `${base} Errors: ${errors.join("; ")}` : base;

    return { ok: errors.length === 0, message, created, deleted };
  } catch (err) {
    return { ok: false, message: `Apply failed: ${String(err)}`, created: 0, deleted: 0 };
  }
}
