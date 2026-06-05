import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import DraftCard from "./draft-card";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const [playerRes, settingsRes, draftCountRes] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select("status, draft_entered")
      .eq("discord_id", session.userId)
      .single(),
    supabaseAdmin.from("league_settings").select("draft_open, draft_active, season_active, num_teams").single(),
    supabaseAdmin
      .from("players")
      .select("*", { count: "exact", head: true })
      .eq("status", "approved")
      .eq("draft_entered", true),
  ]);

  const player = playerRes.data;
  const settings = settingsRes.data;
  const draftCount = draftCountRes.count ?? 0;

  // Show signup card only during the open-signups window, not during the snake draft itself or season
  const signupsOpen = (settings?.draft_open ?? false) && !(settings?.draft_active ?? false) && !(settings?.season_active ?? false);
  const isApproved = player?.status === "approved";
  const inDraft = player?.draft_entered ?? false;

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Welcome back, {session.username}
        </p>
      </div>

      {isApproved && (
        <DraftCard
          inDraft={inDraft}
          draftCount={draftCount}
          signupsOpen={signupsOpen}
          draftActive={settings?.draft_active ?? false}
          seasonActive={settings?.season_active ?? false}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Draft pool" value={draftCount} />
        <Stat label="Teams" value={settings?.num_teams ?? 0} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
    </div>
  );
}
