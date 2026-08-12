import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { joinAsGuest } from "./actions";

function JoinMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-2">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <p className="text-zinc-400 text-sm">{body}</p>
      </div>
    </div>
  );
}

export default async function SponsorJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Joining as a guest issues a fresh session cookie — if someone is already
  // logged in (as a player, staff, or another guest), don't silently clobber
  // that session by walking through this flow.
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (session?.userId) redirect("/dashboard");

  const { data: sponsor } = await supabaseAdmin
    .from("sponsors")
    .select("id, name, max_uses")
    .eq("invite_token", token)
    .eq("status", "active")
    .single();

  if (!sponsor) {
    return <JoinMessage title="Invite link not found" body="This sponsor link is invalid or has been disabled." />;
  }

  const { count } = await supabaseAdmin
    .from("sponsor_members")
    .select("id", { count: "exact", head: true })
    .eq("sponsor_id", sponsor.id);

  if ((count ?? 0) >= sponsor.max_uses) {
    return <JoinMessage title="This invite link is full" body={`Ask ${sponsor.name} for a new invite link.`} />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-white">Welcome, {sponsor.name}</h1>
          <p className="text-zinc-400 text-sm">
            You&apos;re joining CRL West 6mans as a sponsor guest. You&apos;ll get a dashboard login to
            view the league, but you won&apos;t be able to register as a player, join a draft, or join a team.
          </p>
        </div>
        <form action={joinAsGuest.bind(null, token)}>
          <button
            type="submit"
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
