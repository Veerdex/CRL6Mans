import { config } from "dotenv";
config({ path: ".env.local" });

const APPLICATION_ID = process.env.DISCORD_CLIENT_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const commands = [
  {
    name: "totalplayers",
    description: "Show the total number of approved registered players",
  },
  {
    name: "totalusers",
    description: "Show the total number of users in the system (all statuses)",
  },
  {
    name: "pending",
    description: "List all pending registration requests",
  },
  {
    name: "approve",
    description: "Approve a player's registration",
    options: [
      { name: "username", description: "Discord username of the player", type: 3, required: true, autocomplete: true },
    ],
  },
  {
    name: "reject",
    description: "Reject a player's registration",
    options: [
      { name: "username", description: "Discord username of the player", type: 3, required: true, autocomplete: true },
    ],
  },
  {
    name: "playerinfo",
    description: "Look up a player's stats and registration info",
    options: [
      { name: "username", description: "Discord username of the player", type: 3, required: true, autocomplete: true },
    ],
  },
  {
    name: "setnumteams",
    description: "Set the number of teams for the draft",
    options: [
      { name: "count", description: "Number of teams, or 'max' to auto-calculate (3 players/team)", type: 3, required: true },
    ],
  },
  {
    name: "setdraftchannel",
    description: "Set the channel where draft announcements and picks will be posted (admin only)",
    options: [
      { name: "channel", description: "The draft channel", type: 7, required: true, channel_types: [0] },
    ],
  },
  {
    name: "startdraft",
    description: "Start the draft for the current season",
  },
  {
    name: "enddraft",
    description: "End the draft and lock all rosters",
  },
  {
    name: "draftpool",
    description: "List all eligible players for the draft, sorted by rank value",
  },
  {
    name: "draftcount",
    description: "Show the number of players who have entered the draft",
  },
  {
    name: "enterdraft",
    description: "Enter yourself into the draft pool",
  },
  {
    name: "leavedraft",
    description: "Remove yourself from the draft pool",
  },
  {
    name: "nominate",
    description: "Nominate a player for auction (your turn to nominate, max starting bid 800)",
    options: [
      { name: "player", description: "Player to nominate", type: 3, required: true, autocomplete: true },
      { name: "bid", description: "Starting bid (1–800 credits)", type: 4, required: true, min_value: 1, max_value: 800 },
    ],
  },
  {
    name: "bid",
    description: "Place a bid on the current player up for auction",
    options: [
      { name: "amount", description: "Credits to bid (must be higher than current bid)", type: 4, required: true, min_value: 1 },
    ],
  },
  {
    name: "endround",
    description: "Close the current auction round and assign the player to the highest bidder (admin only)",
  },
  {
    name: "budget",
    description: "Check your team's remaining credits and max bid during the auction draft",
  },
  {
    name: "assignteam",
    description: "Assign a player to a team (creates team if it doesn't exist)",
    options: [
      { name: "player", description: "Discord username of the player", type: 3, required: true, autocomplete: true },
      { name: "team", description: "Team name", type: 3, required: true },
    ],
  },
  {
    name: "startseason",
    description: "Officially start the season",
  },
  {
    name: "reportresult",
    description: "Report the result of a match",
    options: [
      { name: "team1", description: "Name of the first team", type: 3, required: true, autocomplete: true },
      { name: "score1", description: "Score of the first team", type: 4, required: true },
      { name: "team2", description: "Name of the second team", type: 3, required: true, autocomplete: true },
      { name: "score2", description: "Score of the second team", type: 4, required: true },
    ],
  },
  {
    name: "standings",
    description: "Show current team standings",
  },
  {
    name: "myteam",
    description: "Show your team info, record, roster, and next scheduled match",
  },
  {
    name: "score",
    description: "Submit the series result for the match in this channel, then delete it (admin only)",
    options: [
      { name: "home", description: "Score for the home team (listed first in the channel name)", type: 4, required: true, min_value: 0 },
      { name: "away", description: "Score for the away team (listed second in the channel name)", type: 4, required: true, min_value: 0 },
    ],
  },
  {
    name: "setmatchcategory",
    description: "Set the Discord category where match channels will be created (admin only)",
    options: [
      { name: "category", description: "The category to use", type: 7, required: true, channel_types: [4] },
    ],
  },
  {
    name: "setdeadlineday",
    description: "Set the day of the week matches must be completed by (admin only)",
    options: [
      {
        name: "day", description: "Deadline day of the week", type: 4, required: true,
        choices: [
          { name: "Sunday", value: 0 }, { name: "Monday", value: 1 }, { name: "Tuesday", value: 2 },
          { name: "Wednesday", value: 3 }, { name: "Thursday", value: 4 },
          { name: "Friday", value: 5 }, { name: "Saturday", value: 6 },
        ],
      },
    ],
  },
  {
    name: "setplaytime",
    description: "Set the default play day and hour for match channels (admin only)",
    options: [
      {
        name: "day", description: "Default play day", type: 4, required: true,
        choices: [
          { name: "Sunday", value: 0 }, { name: "Monday", value: 1 }, { name: "Tuesday", value: 2 },
          { name: "Wednesday", value: 3 }, { name: "Thursday", value: 4 },
          { name: "Friday", value: 5 }, { name: "Saturday", value: 6 },
        ],
      },
      {
        name: "hour", description: "Hour in Pacific Time (0–23, e.g. 19 = 7 pm)", type: 4, required: true,
        min_value: 0, max_value: 23,
      },
    ],
  },
  {
    name: "setruleschannel",
    description: "Set the channel linked in match channel messages as the rulebook (admin only)",
    options: [
      { name: "channel", description: "The rules channel", type: 7, required: true, channel_types: [0] },
    ],
  },
  {
    name: "openround",
    description: "Create match channels for all currently scheduled matches (admin only)",
    options: [
      { name: "round", description: "Override the round number shown in the message (default: round number)", type: 4, required: false },
    ],
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
    description: "Assign a Discord role to any server member by mention (admin only, no database required)",
    options: [
      { name: "user", description: "The server member to assign the role to", type: 6, required: true },
      { name: "role", description: "The role to assign", type: 8, required: true },
    ],
  },
  {
    name: "removerole",
    description: "Remove a Discord role from any server member by mention (admin only)",
    options: [
      { name: "user", description: "The server member to remove the role from", type: 6, required: true },
      { name: "role", description: "The role to remove", type: 8, required: true },
    ],
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
