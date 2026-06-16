import { NextResponse } from "next/server";
import { execAutoPick } from "@/app/lib/discord-bot";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Loop to handle multiple consecutive timeouts (e.g., several captains all AFK)
  let iterations = 0;
  while (iterations < 30) {
    const result = await execAutoPick();
    if (result.done) break;
    iterations++;
  }

  return NextResponse.json({ ok: true, iterations });
}
