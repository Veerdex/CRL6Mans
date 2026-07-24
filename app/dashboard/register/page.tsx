import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { isGuildMember } from "@/app/lib/discord-api";
import { RegisterForm, type ExistingPlayerData } from "./register-form";

export default async function RegisterPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  // Registration status lives on accounts (Tier 1) now; tracker/MMR fields
  // to pre-fill a resubmission live on pending_players (Tier 2).
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("id, status")
    .eq("discord_id", session.userId)
    .single();

  if (account?.status === "approved") redirect("/dashboard");

  const { data: existing } = account
    ? await supabaseAdmin
        .from("pending_players")
        .select("tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2, college_image_url, sub_willing")
        .eq("account_id", account.id)
        .single()
    : { data: null };

  const inServer = await isGuildMember(session.userId);
  if (!inServer) {
    const inviteUrl = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL?.trim() || process.env.DISCORD_INVITE_URL?.trim() || null;
    return (
      <div className="p-8 max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-2">Join the Discord First</h1>
        <p className="text-zinc-400 text-sm mb-4">
          You must be a member of the CRL Discord server before you can register.
          Join the server, then come back to this page.
        </p>
        {inviteUrl && (
          <a
            href={inviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Join the Discord Server
          </a>
        )}
      </div>
    );
  }

  if (account?.status === "pending") {
    return (
      <div className="p-8 max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-2">Registration Pending</h1>
        <p className="text-zinc-400 text-sm">
          Your registration is under review. You cannot re-submit while it is pending.
          An admin will reach out via Discord if there are any issues.
        </p>
      </div>
    );
  }

  const isResubmit = account?.status === "rejected";
  const existingData: ExistingPlayerData | null = isResubmit && existing
    ? {
        tracker_url:       existing.tracker_url,
        peak_3v3:          existing.peak_3v3,
        current_3v3:       existing.current_3v3,
        peak_2v2:          existing.peak_2v2,
        current_2v2:       existing.current_2v2,
        college_image_url: existing.college_image_url,
        sub_willing:       existing.sub_willing ?? false,
      }
    : null;

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-2xl font-bold text-white mb-1">
        {isResubmit ? "Re-submit Registration" : "Register"}
      </h1>
      <p className="text-zinc-400 text-sm mb-8">
        Fill out your ranks and upload proof of college enrollment to register.
        An admin will review your submission.
      </p>

      {isResubmit && (
        <div className="mb-6 bg-red-950/40 border border-red-700/50 rounded-xl px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-red-300">Your registration was rejected</p>
          <p className="text-sm text-red-400/80">
            Please review and update your information, then re-submit. Your previous
            values have been pre-filled. You may keep your existing enrollment proof
            or upload a new one.
          </p>
        </div>
      )}

      <RegisterForm isResubmit={isResubmit} existing={existingData} />
    </div>
  );
}
