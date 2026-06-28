import { config } from "dotenv";
config({ path: ".env.local" });

const APPLICATION_ID = process.env.DISCORD_CLIENT_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const commands = [
  {
    name: "setdraftchannel",
    description: "Set the draft announcements/picks channel — run in the target channel (admin only)",
  },
  {
    name: "pick",
    description: "Pick a player for your team during the snake draft",
    options: [
      { name: "player", description: "Player to pick from the draft pool", type: 3, required: true, autocomplete: true },
    ],
  },
  // Auction draft commands — kept for future use, not currently registered
  // {
  //   name: "nominate",
  //   description: "Nominate a player for auction (your turn to nominate, max starting bid 800)",
  //   options: [
  //     { name: "player", description: "Player to nominate", type: 3, required: true, autocomplete: true },
  //     { name: "bid", description: "Starting bid (1–800 credits)", type: 4, required: true, min_value: 1, max_value: 800 },
  //   ],
  // },
  // {
  //   name: "bid",
  //   description: "Place a bid on the current player up for auction",
  //   options: [
  //     { name: "amount", description: "Credits to bid (must be higher than current bid)", type: 4, required: true, min_value: 1 },
  //   ],
  // },
  // {
  //   name: "endround",
  //   description: "Close the current auction round and assign the player to the highest bidder (admin only)",
  // },
  // {
  //   name: "budget",
  //   description: "Check your team's remaining credits and max bid during the auction draft",
  // },
  {
    name: "setruleschannel",
    description: "Set the rulebook channel linked in match messages — run in the target channel (admin only)",
  },
  {
    name: "syncroles",
    description: "Create missing Discord roles and assign them to all players based on current DB state (admin only)",
  },
  {
    name: "diagroles",
    description: "Diagnose why your Discord roles may not be assigned (admin only)",
  },
  {
    name: "assignrole",
    description: "Assign a Discord role to a user (admin only)",
    options: [
      { name: "user", description: "The user to assign the role to", type: 6, required: true },
      { name: "role", description: "The role to assign", type: 8, required: true },
    ],
  },
  {
    name: "removerole",
    description: "Remove a Discord role from a user (admin only)",
    options: [
      { name: "user", description: "The user to remove the role from", type: 6, required: true },
      { name: "role", description: "The role to remove", type: 8, required: true },
    ],
  },
  {
    name: "setmoderatorid",
    description: "Set the Discord role used as Moderator, for staff pings (admin only)",
    options: [{ name: "role", description: "The Moderator role", type: 8, required: true }],
  },
  {
    name: "setdirectorid",
    description: "Set the Discord role used as Director, for staff pings (admin only)",
    options: [{ name: "role", description: "The Director role", type: 8, required: true }],
  },
  {
    name: "setceoid",
    description: "Set the Discord role used as CEO, for staff pings (admin only)",
    options: [{ name: "role", description: "The CEO role", type: 8, required: true }],
  },
];

const GUILD_ID = process.env.DISCORD_GUILD_ID;
const globalEndpoint = `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;
const headers = { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" };

if (GUILD_ID) {
  // Clear global commands so they don't show up alongside guild commands
  const clearRes = await fetch(globalEndpoint, { method: "PUT", headers, body: JSON.stringify([]) });
  if (clearRes.ok) console.log("🧹 Cleared global commands.");

  console.log(`Registering to guild ${GUILD_ID} (instant)...`);
  const res = await fetch(
    `https://discord.com/api/v10/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands`,
    { method: "PUT", headers, body: JSON.stringify(commands) }
  );
  if (!res.ok) { console.error("Failed:", await res.text()); process.exit(1); }
  console.log(`✅ Registered ${commands.length} guild commands successfully.`);
} else {
  console.log("Registering globally (up to 1 hour)...");
  const res = await fetch(globalEndpoint, { method: "PUT", headers, body: JSON.stringify(commands) });
  if (!res.ok) { console.error("Failed:", await res.text()); process.exit(1); }
  console.log(`✅ Registered ${commands.length} global commands successfully.`);
}
