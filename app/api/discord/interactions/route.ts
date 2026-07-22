import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import nacl from "tweetnacl";
import { handleCommand, handleAutocomplete, handleModalSubmit } from "@/app/lib/discord-bot";

const DEFERRED_COMMANDS = new Set(["openround"]);
// Subcommands of /admin that are slow enough to need deferral (matched against
// interaction.data.options[0].name, since Discord nests subcommand names one level deep).
const DEFERRED_ADMIN_SUBCOMMANDS = new Set(["syncroles", "disconnect", "wipe"]);
const DEFERRED_MODALS = new Set(["confirm_startdraft", "confirm_enddraft", "confirm_startseason"]);

function verify(publicKey: string, signature: string, timestamp: string, body: string): boolean {
  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + body),
      Buffer.from(signature, "hex"),
      Buffer.from(publicKey, "hex")
    );
  } catch {
    return false;
  }
}

async function followUp(token: string, content: string) {
  const appId = process.env.DISCORD_CLIENT_ID;
  if (!appId) { console.error("[followUp] DISCORD_CLIENT_ID is not set"); return; }
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-signature-ed25519") ?? "";
  const timestamp = req.headers.get("x-signature-timestamp") ?? "";
  const rawBody = await req.text();

  if (!verify(process.env.DISCORD_PUBLIC_KEY!, signature, timestamp, rawBody)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  // Defense-in-depth: reject interactions with timestamps older than 5 minutes
  // to limit the replay window if a signed request were ever captured in transit.
  const timestampSec = parseInt(timestamp, 10);
  if (isNaN(timestampSec) || Math.abs(Date.now() / 1000 - timestampSec) > 300) {
    return new NextResponse("Request timestamp is too old", { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  // PING
  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  // Modal submit
  if (interaction.type === 5) {
    const customId: string = interaction.data?.custom_id ?? "";

    // Long-running modals: acknowledge immediately, process in background
    if (DEFERRED_MODALS.has(customId)) {
      const token: string = interaction.token;
      after(async () => {
        try {
          const result = await handleModalSubmit(interaction);
          const content = (result as { data?: { content?: string } }).data?.content ?? "✅ Done.";
          await followUp(token, content);
        } catch (err) {
          console.error("[discord deferred modal error]", err);
          await followUp(token, "❌ Internal error — check server logs.");
        }
      });
      return NextResponse.json({ type: 5, data: { flags: 64 } });
    }

    try {
      const response = await handleModalSubmit(interaction);
      return NextResponse.json(response);
    } catch (err) {
      console.error("[discord modal error]", err);
      return NextResponse.json({ type: 4, data: { content: "❌ Internal error — check server logs." } });
    }
  }

  // Autocomplete
  if (interaction.type === 4) {
    try {
      const response = await handleAutocomplete(interaction);
      return NextResponse.json(response);
    } catch (err) {
      console.error("[discord autocomplete error]", err);
      return NextResponse.json({ type: 8, data: { choices: [] } });
    }
  }

  // Slash commands
  if (interaction.type === 2) {
    const name = interaction.data?.name;
    const subName = name === "admin" ? interaction.data?.options?.[0]?.name : undefined;

    // Long-running commands: acknowledge immediately, run in background via after()
    if (DEFERRED_COMMANDS.has(name) || (subName && DEFERRED_ADMIN_SUBCOMMANDS.has(subName))) {
      const token: string = interaction.token;
      after(async () => {
        try {
          const result = await handleCommand(interaction);
          const content = (result as { data?: { content?: string } }).data?.content ?? "✅ Done.";
          await followUp(token, content);
        } catch (err) {
          console.error("[discord deferred error]", err);
          await followUp(token, "❌ Internal error — check server logs.");
        }
      });
      // Deferred ephemeral — only the invoking admin sees the loading state
      return NextResponse.json({ type: 5, data: { flags: 64 } });
    }

    try {
      const response = await handleCommand(interaction);
      return NextResponse.json(response);
    } catch (err) {
      console.error("[discord interaction error]", err);
      return NextResponse.json({ type: 4, data: { content: "❌ Internal error — check server logs." } });
    }
  }

  return new NextResponse("Unknown interaction type", { status: 400 });
}
