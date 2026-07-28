import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { ArchiveViewerClient } from "./archive-viewer-client";

export default async function ViewArchivePage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">View Archived Tournament/Season</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Upload a downloaded archive JSON file to view its full standings, bracket, rosters, and stats.
        </p>
      </div>
      <ArchiveViewerClient />
    </div>
  );
}
