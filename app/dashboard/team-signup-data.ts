import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase";
import {
  earlySignupAccessByPlayerId,
  hasEarlySignupAccess,
  signupWindowOpen,
  type SignupWindowRow,
} from "@/app/lib/signup-window";

export type SignupMember = {
  memberId: string;
  playerId: string;
  username: string;
  display_name: string | null;
  status: "invited" | "accepted";
  isCreator: boolean;
};

export type TeamSignupView = {
  registrationOpen: boolean;
  myTeam:
    | { id: string; name: string; isCreator: boolean; members: SignupMember[] }
    | null;
  // canAccept is per-invite because Early Signup Access belongs to the team's
  // creator: during the early window one invite can be actionable while
  // another, from a non-supporter's team, is not.
  incomingInvites: { memberId: string; teamName: string; creatorName: string; canAccept: boolean }[];
  invitable: { id: string; username: string; display_name: string | null }[];
};

type RawMember = { id: string; player_id: string; status: "invited" | "accepted" };
type RawSignup = {
  id: string;
  name: string;
  creator_player_id: string;
  team_signup_members: RawMember[];
};

export async function getTeamSignupView(
  playerId: string,
  tournamentId: string,
  window: SignupWindowRow,
  discordId: string
): Promise<TeamSignupView> {
  const { data: signupsRaw } = await supabaseAdmin
    .from("team_signups")
    .select("id, name, creator_player_id, team_signup_members(id, player_id, status)")
    .eq("tournament_id", tournamentId);
  const signups = (signupsRaw ?? []) as RawSignup[];

  // Resolve usernames for everyone involved
  const ids = new Set<string>();
  for (const s of signups) {
    ids.add(s.creator_player_id);
    for (const m of s.team_signup_members) ids.add(m.player_id);
  }
  const { data: players } = ids.size
    ? await supabaseAdmin.from("players").select("id, username, display_name").in("id", [...ids])
    : { data: [] as { id: string; username: string; display_name: string | null }[] };
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));

  // Player IDs already accepted on some team (can't be invited / can't create)
  const acceptedPlayerIds = new Set<string>();
  for (const s of signups)
    for (const m of s.team_signup_members)
      if (m.status === "accepted") acceptedPlayerIds.add(m.player_id);

  // My team = the one I'm accepted on
  const mine = signups.find((s) =>
    s.team_signup_members.some((m) => m.player_id === playerId && m.status === "accepted")
  );

  const myTeam = mine
    ? {
        id: mine.id,
        name: mine.name,
        isCreator: mine.creator_player_id === playerId,
        members: mine.team_signup_members
          .map((m) => ({
            memberId: m.id,
            playerId: m.player_id,
            username: playerById.get(m.player_id)?.username ?? "Unknown",
            display_name: playerById.get(m.player_id)?.display_name ?? null,
            status: m.status,
            isCreator: m.player_id === mine.creator_player_id,
          }))
          // accepted first (creator at the very top), then pending invites
          .sort((a, b) => {
            if (a.isCreator !== b.isCreator) return a.isCreator ? -1 : 1;
            if (a.status !== b.status) return a.status === "accepted" ? -1 : 1;
            return a.username.localeCompare(b.username);
          }),
      }
    : null;

  // Invites addressed to me (only relevant if I'm not yet on a team)
  const inviteRows = myTeam
    ? []
    : signups.flatMap((s) =>
        s.team_signup_members
          .filter((m) => m.player_id === playerId && m.status === "invited")
          .map((m) => ({
            memberId: m.id,
            teamName: s.name,
            creatorPlayerId: s.creator_player_id,
            creatorName: playerById.get(s.creator_player_id)?.username ?? "Unknown",
          }))
      );

  // Whoever governs each action decides its window: the creator once I'm on a
  // team (their Early Signup Access covers the roster they built), my own
  // entitlement while I'm still deciding whether to create one, and the
  // inviting creator's for each pending invite.
  const earlyCreators = await earlySignupAccessByPlayerId([
    ...(mine ? [mine.creator_player_id] : []),
    ...inviteRows.map((i) => i.creatorPlayerId),
  ]);
  const registrationOpen = signupWindowOpen(
    window,
    mine ? earlyCreators.has(mine.creator_player_id) : await hasEarlySignupAccess(discordId)
  );
  const incomingInvites = inviteRows.map(({ creatorPlayerId, ...inv }) => ({
    ...inv,
    canAccept: signupWindowOpen(window, earlyCreators.has(creatorPlayerId)),
  }));

  // Players the creator can still invite: approved, not accepted anywhere, not already on my roster
  let invitable: { id: string; username: string; display_name: string | null }[] = [];
  if (myTeam?.isCreator && registrationOpen) {
    const onMyRoster = new Set(mine!.team_signup_members.map((m) => m.player_id));
    const { data: approved } = await supabaseAdmin
      .from("players")
      .select("id, username, display_name")
      .eq("status", "approved")
      .order("username");
    invitable = (approved ?? []).filter(
      (p) => !acceptedPlayerIds.has(p.id) && !onMyRoster.has(p.id)
    );
  }

  return { registrationOpen, myTeam, incomingInvites, invitable };
}
