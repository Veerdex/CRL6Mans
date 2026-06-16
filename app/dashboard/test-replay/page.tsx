import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isDirector } from "@/app/lib/players";
import { ReplayTester } from "./replay-tester";

export default async function TestReplayPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirector(session.userId))) redirect("/dashboard");

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Replay Analyzer</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Upload a <code className="text-zinc-300">.replay</code> file to extract per-player stats from the header.
        </p>
      </div>
      <ReplayTester />
    </div>
  );
}
