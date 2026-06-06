import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { RegisterForm, type ExistingPlayerData } from "./register-form";

export default async function RegisterPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: existing } = await supabaseAdmin
    .from("players")
    .select("status, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2, college_image_url, sub_willing")
    .eq("discord_id", session.userId)
    .single();

  if (existing?.status === "approved") redirect("/dashboard");
  if (existing?.status === "pending") {
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

  const isResubmit = existing?.status === "rejected";
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
