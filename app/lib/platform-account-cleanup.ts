import "server-only";
import { supabaseAdmin } from "./supabase";

const BUCKET = "platform-verification-replays";

// previewClaimReplay (app/dashboard/settings/platform-account-actions.ts) uploads
// a replay before any player_platform_accounts row exists to reference it, so an
// abandoned preview or a superseded retry leaves a file with no other cleanup
// path. Give an in-progress claim this long to finish before treating its upload
// as orphaned.
const ORPHAN_MIN_AGE_MS = 6 * 60 * 60 * 1000;

export async function cleanupOrphanedVerificationReplays(): Promise<{ removed: number }> {
  const { data: inUse } = await supabaseAdmin
    .from("player_platform_accounts")
    .select("claimed_verification_replay_path")
    .not("claimed_verification_replay_path", "is", null);
  const inUsePaths = new Set((inUse ?? []).map((r) => r.claimed_verification_replay_path as string));

  const { data: entries } = await supabaseAdmin.storage.from(BUCKET).list();
  const staleCutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  const toRemove: string[] = [];

  for (const entry of entries ?? []) {
    // Root-level list() mixes files with per-player pseudo-folders; folders come
    // back with id: null since they aren't real storage objects.
    if (entry.id !== null) continue;

    const { data: files } = await supabaseAdmin.storage.from(BUCKET).list(entry.name);
    for (const file of files ?? []) {
      const path = `${entry.name}/${file.name}`;
      if (inUsePaths.has(path)) continue;

      const match = file.name.match(/^claim-(\d+)\.replay$/);
      const uploadedAt = match ? Number(match[1]) : 0;
      if (uploadedAt > staleCutoff) continue;

      toRemove.push(path);
    }
  }

  if (toRemove.length) await supabaseAdmin.storage.from(BUCKET).remove(toRemove);
  return { removed: toRemove.length };
}
