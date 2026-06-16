import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { getLeaderboard } from "./actions";
import FlappyBird from "./flappy-bird";

export default async function GamePage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const leaderboard = await getLeaderboard();

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-white mb-1">Game</h1>
      <p className="text-sm text-zinc-400 mb-8">
        A little something for the waiting room. Beat the leaderboard.
      </p>
      <FlappyBird
        username={session.username ?? ""}
        initialLeaderboard={leaderboard}
      />
    </div>
  );
}
