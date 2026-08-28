import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { getLeaderboard } from "./actions";
import FlappyBird from "./flappy-bird";
import { SponsoredByLine } from "@/app/dashboard/sponsored-by-line";

export default async function GamePage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const leaderboard = await getLeaderboard();

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-center gap-2 flex-wrap mb-1">
        <h1 className="text-2xl font-bold text-white">Game</h1>
        <SponsoredByLine tabKey="game" />
      </div>
      <p className="text-sm text-zinc-400 mb-8 mt-1 text-center">
        A little something for the waiting room. Beat the leaderboard.
      </p>
      <FlappyBird
        username={session.username ?? ""}
        initialLeaderboard={leaderboard}
      />
    </div>
  );
}
