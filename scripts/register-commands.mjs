import { config } from "dotenv";
config({ path: ".env.local" });

const APPLICATION_ID = process.env.DISCORD_CLIENT_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Hides admin commands from non-staff users in Discord's command picker.
// Server-side adminGuard still enforces access regardless of this setting.
const ADMIN_ONLY = { default_member_permissions: "0" };

// Subcommand type constants (Discord ApplicationCommandOptionType)
const SUB_COMMAND = 1;
const STRING = 3;
const BOOLEAN = 5;
const USER = 6;
const CHANNEL = 7;
const ROLE = 8;

const commands = [
  {
    name: "admin",
    description: "Admin-only league management commands",
    ...ADMIN_ONLY,
    options: [
      {
        type: SUB_COMMAND,
        name: "setdraftchannel",
        description: "Set the draft announcements/picks channel — run in the target channel",
      },
      {
        type: SUB_COMMAND,
        name: "setruleschannel",
        description: "Set the rulebook channel linked in match messages — run in the target channel",
      },
      {
        type: SUB_COMMAND,
        name: "setannouncement",
        description: "Set the channel where league announcements are posted — run in the target channel",
      },
      {
        type: SUB_COMMAND,
        name: "setmatchcategoryanchor",
        description: "Place new match categories after this one — omit to reset to bottom",
        options: [
          { name: "category", description: "Existing category to anchor new match categories after", type: CHANNEL, channel_types: [4], required: false },
        ],
      },
      {
        type: SUB_COMMAND,
        name: "syncroles",
        description: "Create missing Discord roles and assign them to all players based on current DB state",
        options: [
          { name: "sync_registered", description: "Also reconcile the Registered role", type: BOOLEAN, required: true },
        ],
      },
      {
        type: SUB_COMMAND,
        name: "diagroles",
        description: "Diagnose why your Discord roles may not be assigned",
      },
      {
        type: SUB_COMMAND,
        name: "assignrole",
        description: "Assign a Discord role to a user",
        options: [
          { name: "user", description: "The user to assign the role to", type: USER, required: true },
          { name: "role", description: "The role to assign", type: ROLE, required: true },
        ],
      },
      {
        type: SUB_COMMAND,
        name: "removerole",
        description: "Remove a Discord role from a user",
        options: [
          { name: "user", description: "The user to remove the role from", type: USER, required: true },
          { name: "role", description: "The role to remove", type: ROLE, required: true },
        ],
      },
      {
        type: SUB_COMMAND,
        name: "setmoderatorid",
        description: "Set the Discord role used as Moderator, for staff pings",
        options: [{ name: "role", description: "The Moderator role", type: ROLE, required: true }],
      },
      {
        type: SUB_COMMAND,
        name: "setdirectorid",
        description: "Set the Discord role used as Director, for staff pings",
        options: [{ name: "role", description: "The Director role", type: ROLE, required: true }],
      },
      {
        type: SUB_COMMAND,
        name: "setceoid",
        description: "Set the Discord role used as CEO, for staff pings",
        options: [{ name: "role", description: "The CEO role", type: ROLE, required: true }],
      },
      {
        type: SUB_COMMAND,
        name: "setregisteredrole",
        description: "Set the role given to players when their registration is approved",
        options: [{ name: "role", description: "The Registered role", type: ROLE, required: true }],
      },
      {
        type: SUB_COMMAND,
        name: "checklist",
        description: "List what's still missing to make the server functional for the website (Director+)",
      },
      {
        type: SUB_COMMAND,
        name: "disconnect",
        description: "CEO only: clear all Discord channel/role IDs from the DB — no changes made in Discord itself",
        options: [
          { name: "confirm", description: 'Type exactly: CONFIRM DISCONNECT', type: STRING, required: true },
        ],
      },
      {
        type: SUB_COMMAND,
        name: "wipe",
        description: "CEO only: clear all game/season data, keeping the Discord connection and staff roles",
        options: [
          { name: "confirm", description: 'Type exactly: CONFIRM WIPE', type: STRING, required: true },
          { name: "clear_history", description: "Also delete the completed-seasons archive (default: false)", type: BOOLEAN, required: false },
        ],
      },
      {
        type: SUB_COMMAND,
        name: "resyncmoderation",
        description: "CEO only: re-apply bans/timeouts/Kicked role to this guild for players the DB says are banned/kicked",
      },
    ],
  },
  {
    name: "site",
    description: "Get the link to the CRL 6Mans website",
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
