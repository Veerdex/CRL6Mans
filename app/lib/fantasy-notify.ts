import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "./supabase";
import { accountName } from "./fantasy-leagues";
import { pushToPlayerIds, type NotificationCategory } from "./push";

// Fantasy notices (docs/fantasy-rl.md §12). A manager is an account and
// players.id is the account id, so the push honours each manager's category
// toggles in Settings.

export type FantasyCategory = Extract<NotificationCategory, `fantasy_${string}`>;

type Notice = { title: string; body: string; url: string; tag?: string };

/**
 * Sent after the response, so a slow or failing push can never hold up or
 * fail the pick, trade or run that caused it.
 */
export function notifyManagers(accountIds: string[], category: FantasyCategory, notice: Notice): void {
  const ids = [...new Set(accountIds)];
  if (!ids.length) return;
  const send = () =>
    pushToPlayerIds(ids, { ...notice, category }).catch((e) =>
      console.error(`[fantasy] ${category} notice "${notice.title}" failed:`, e),
    );
  try {
    after(send);
  } catch {
    void send();
  }
}

export async function accountNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data } = await supabaseAdmin.from("accounts").select("id, username, display_name").in("id", unique);
  return new Map(
    ((data ?? []) as { id: string; username: string | null; display_name: string | null }[]).map((a) => [a.id, accountName(a)]),
  );
}

/** "1:30", "5 minutes", "30 seconds". */
export function clockLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
