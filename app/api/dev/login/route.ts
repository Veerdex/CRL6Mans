import { NextRequest, NextResponse } from "next/server";
import { createSession, deleteSession } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

// Local-only session swap, so the unregistered experience can be looked at
// without touching a real account. `next build` sets NODE_ENV=production, so
// this route does not exist on a deployed build — that gate is the whole of its
// security, which is why it runs before anything else and why the account it
// logs into is restricted to the `test_` prefix `createTestAccounts` uses.
const TEST_DISCORD_ID = "test_unregistered";
const TEST_USERNAME = "TestUnregistered";

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return notFound();

  const origin = new URL(request.url).origin;
  const params = request.nextUrl.searchParams;

  if (params.get("logout") !== null) {
    await deleteSession();
    return NextResponse.redirect(`${origin}/login`);
  }

  const { data: existing } = await supabaseAdmin
    .from("accounts")
    .select("id, username, session_version")
    .eq("discord_id", TEST_DISCORD_ID)
    .maybeSingle();

  let account = existing;

  if (!account) {
    // crl_coins is deliberately left off so the column default (the 500-coin
    // signup grant) applies, the same way a real first login gets it.
    const { data: created, error } = await supabaseAdmin
      .from("accounts")
      .insert({
        discord_id: TEST_DISCORD_ID,
        username: TEST_USERNAME,
        avatar: null,
        status: "unregistered",
        updated_at: new Date().toISOString(),
      })
      .select("id, username, session_version")
      .single();
    if (error || !created) {
      return new NextResponse(`Failed to create the test account: ${error?.message ?? "unknown error"}`, { status: 500 });
    }
    account = created;
  } else if (params.get("reset") !== null) {
    // Registering flips the account to `pending`, which makes it single-use
    // otherwise. Tier 2/3 rows are dropped too so the register form comes back
    // blank rather than pre-filled from the last run.
    await supabaseAdmin.from("players").delete().eq("account_id", account.id);
    await supabaseAdmin.from("pending_players").delete().eq("account_id", account.id);
    await supabaseAdmin
      .from("accounts")
      .update({
        status: "unregistered",
        registration_bonus_granted: false,
        coin_grant_pending_register: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);
  }

  await createSession(
    TEST_DISCORD_ID,
    (account.username as string | null) ?? TEST_USERNAME,
    null,
    (account.session_version as number | null) ?? 0,
  );

  return NextResponse.redirect(`${origin}/dashboard`);
}
