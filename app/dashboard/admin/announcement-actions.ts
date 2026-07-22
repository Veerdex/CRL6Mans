"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirector } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { sendChannelMessage, getGuildRoles, getGuildChannels, searchGuildMembers } from "@/app/lib/discord-api";
import { pushToAllApproved } from "@/app/lib/push";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

type AtResolution =
  | { kind: "everyone" }
  | { kind: "role"; id: string }
  | { kind: "member"; id: string; exact: boolean; display: string }
  | null;

// Looks up every #channel and @name token against the guild once, so both
// the real send path and the admin's on-demand mention check agree on what
// resolves — an admin should never see "will ping" in one and not the other.
async function resolveTokens(text: string): Promise<{
  channelResolutions: Map<string, string | null>;
  atResolutions: Map<string, AtResolution>;
}> {
  const [roles, channels] = await Promise.all([getGuildRoles(), getGuildChannels()]);

  const channelResolutions = new Map<string, string | null>();
  for (const token of new Set(text.match(/#[A-Za-z0-9_-]+/g) ?? [])) {
    const name = token.slice(1);
    const channel = channels.find(c => c.name.toLowerCase() === name.toLowerCase());
    channelResolutions.set(token, channel?.id ?? null);
  }

  const atResolutions = new Map<string, AtResolution>();
  for (const token of new Set(text.match(/@[A-Za-z0-9_.-]+/g) ?? [])) {
    const name = token.slice(1);
    if (name.toLowerCase() === "everyone" || name.toLowerCase() === "here") {
      atResolutions.set(token, { kind: "everyone" });
      continue;
    }

    const role = roles.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (role) {
      atResolutions.set(token, { kind: "role", id: role.id });
      continue;
    }

    const matches = await searchGuildMembers(name, 5);
    const exactMatch = matches.find(m =>
      m.username.toLowerCase() === name.toLowerCase() ||
      m.globalName?.toLowerCase() === name.toLowerCase() ||
      m.nick?.toLowerCase() === name.toLowerCase(),
    );
    const chosen = exactMatch ?? matches[0] ?? null;
    atResolutions.set(
      token,
      chosen
        ? { kind: "member", id: chosen.id, exact: !!exactMatch, display: chosen.nick ?? chosen.globalName ?? chosen.username }
        : null,
    );
  }

  return { channelResolutions, atResolutions };
}

// Converts friendly @name / #channel references typed by the admin into
// Discord's real mention syntax (<@id>, <@&id>, <#id>) so they actually ping.
// @everyone / @here are left as literal text — Discord recognizes those directly.
async function resolveMentions(text: string): Promise<string> {
  const { channelResolutions, atResolutions } = await resolveTokens(text);

  let result = text.replace(/#[A-Za-z0-9_-]+/g, match => {
    const id = channelResolutions.get(match);
    return id ? `<#${id}>` : match;
  });

  result = result.replace(/@[A-Za-z0-9_.-]+/g, match => {
    const res = atResolutions.get(match);
    if (!res || res.kind === "everyone") return match;
    return res.kind === "role" ? `<@&${res.id}>` : `<@${res.id}>`;
  });

  return result;
}

const MENTION_OK = "OK";
const MENTION_AMBIGUOUS = "AM";
const MENTION_FAIL = "NO";
const MENTION_END = "";

// On-demand, real-lookup preview: wraps each @/# token in a marker the
// shared discord-markdown renderer understands, so the admin sees exactly
// which tokens will actually ping vs. post as plain text — without a
// lookup firing on every keystroke. Fuzzy member matches (no exact username/
// nick/global-name hit) are shown as "will ping <resolved name>" rather than
// green-lighting the typed name verbatim — a near-miss like @Veer could
// resolve to a completely different person than the one typed.
export async function checkAnnouncementMentions(text: string): Promise<{ annotated: string } | { error: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirector(session.userId))) return { error: "Only Directors can post announcements." };

  const withPrefix = text.trim() ? `@everyone\n${text}` : "";
  const { channelResolutions, atResolutions } = await resolveTokens(withPrefix);

  let annotated = withPrefix.replace(/#[A-Za-z0-9_-]+/g, match => {
    const found = channelResolutions.get(match);
    return `${found ? MENTION_OK : MENTION_FAIL}${match}${MENTION_END}`;
  });

  annotated = annotated.replace(/@[A-Za-z0-9_.-]+/g, match => {
    const res = atResolutions.get(match);
    if (!res) return `${MENTION_FAIL}${match}${MENTION_END}`;
    if (res.kind === "member" && !res.exact) {
      return `${MENTION_AMBIGUOUS}@${res.display}${MENTION_END}`;
    }
    return `${MENTION_OK}${match}${MENTION_END}`;
  });

  return { annotated };
}

function stripMarkdownForPush(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\|\|(.+?)\|\|/g, "$1")
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/([*_`])(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

export async function postAnnouncement(text: string): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirector(session.userId))) return { error: "Only Directors can post announcements." };

  const trimmed = text.trim();
  if (!trimmed) return { error: "Announcement text is required." };

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("announcement_channel_id")
    .single();
  const channelId = settings?.announcement_channel_id as string | null;

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({
      announcement_text: trimmed,
      announcement_posted_at: new Date().toISOString(),
      announcement_posted_by: session.userId,
      updated_at: new Date().toISOString(),
    })
    .not("id", "is", null);
  if (error) return { error: error.message };

  if (channelId) {
    const resolvedBody = await resolveMentions(trimmed);
    await sendChannelMessage(channelId, `@everyone\n${resolvedBody}`);
  }

  await pushToAllApproved({
    title: "Announcement",
    body: stripMarkdownForPush(trimmed).slice(0, 150),
    url: "/dashboard",
    category: "announcement",
  });

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function clearAnnouncement(): Promise<{ ok?: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.userId) redirect("/login");
  if (!(await isDirector(session.userId))) return { error: "Only Directors can clear the announcement." };

  const { error } = await supabaseAdmin
    .from("league_settings")
    .update({
      announcement_text: null,
      announcement_posted_at: null,
      announcement_posted_by: null,
      updated_at: new Date().toISOString(),
    })
    .not("id", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard");
  return { ok: true };
}
