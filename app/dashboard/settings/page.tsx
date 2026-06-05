import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("status, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2")
    .eq("discord_id", session.userId)
    .single();

  if (player?.status !== "approved") redirect("/dashboard");

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
      <p className="text-zinc-400 text-sm mb-8">
        Update your Rocket League profile information.
      </p>
      <SettingsForm current={{
        tracker_url:  player.tracker_url  ?? "",
        peak_3v3:     player.peak_3v3     ?? "",
        current_3v3:  player.current_3v3  ?? "",
        peak_2v2:     player.peak_2v2     ?? "",
        current_2v2:  player.current_2v2  ?? "",
      }} />
    </div>
  );
}
