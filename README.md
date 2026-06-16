# CRL 6Mans

Web platform and Discord bot for the CRL West 6mans competitive Rocket League league.

## Rank Value (RV)

Players are ranked by **Rank Value**, which weighs both 2v2 and 3v3 performance:

```
RV = (All Time Peak 2v2 + Season Peak 2v2) × 0.3 + (All Time Peak 3v3 + Season Peak 3v3) × 0.2
```

RV is used for draft ordering, auto-balance team assignment, and sub eligibility limits.

---

## Discord Bot Commands

Staff tiers: **Moderator → Director → CEO** (each tier can act on all tiers below it).
Commands marked **[Staff]** require any staff role. **[Director]** requires director or CEO. **[CEO]** requires CEO only.

---

### Player Info

#### `/totalplayers`
Shows the total number of approved, registered players.

#### `/totalusers`
Shows the total number of users in the system across all statuses (pending, approved, rejected).

#### `/playerinfo <username>`
Looks up a player's full registration info — peak/current 2v2 and 3v3 MMR, rank value, status, and tracker link.

| Option | Description |
|--------|-------------|
| `username` | The player's Discord username |

---

### Draft — [Staff]

#### `/setdraftchannel`
Sets the channel where draft announcements and picks are posted. Run this command inside the target channel.

#### `/pick <player>`
Picks a player for your team during the snake draft. Only usable by the captain whose turn it is.

| Option | Description |
|--------|-------------|
| `player` | Player to pick from the draft pool |

---

### Season — [Staff]

#### `/openround`
Manually opens channels for the next round of matches. **Usually unnecessary** — channels now open automatically for every format: a match's channel is created once both its teams finish their prior-round games (and its category is created lazily if it doesn't exist yet). This command remains as a fallback to create any channel that auto-creation missed.

#### `/setruleschannel`
Sets the channel linked in match messages as the rulebook. Run this command inside the target channel.

---

### Role Management — [Staff]

#### `/syncroles`
Creates missing Discord roles and syncs them to all players based on current DB state.

#### `/diagroles`
Diagnoses why your Discord roles may not be assigned correctly.

#### `/assignrole <user> <role>` / `/removerole <user> <role>`
Manually assigns or removes a staff role (`moderator`, `director`, `ceo`) from a player.

#### `/setmoderatorid <role>` / `/setdirectorid <role>` / `/setceoid <role>`
Stores the **Discord role ID** for each staff tier (saved on `league_settings`) so the bot can @mention/ping that role — e.g. tagging moderators when a sub request is escalated. These configure *which Discord role* maps to each tier; they do **not** grant a person a staff role (use `/assignrole` for that).

| Option | Description |
|--------|-------------|
| `role` | The Discord role to use for that tier |

---

## Discord Bot — What It Does, Permissions & Setup

The "bot" is the league's Discord application. It has **no always-on gateway connection** — it works entirely through **HTTP slash-command interactions** (Ed25519-verified at `/api/discord/interactions`) and **REST calls made with the bot token** from the web app's server actions. From Discord's perspective, every action below is performed by the bot user.

### What it can do

**Roles**
- **Status roles — auto-created and managed by the bot:** `Registered` (on approval), `EnteredDraft` (on joining the draft pool), `Drafted` and `Captain` (on draft/team assignment — the highest-RV player gets `Captain`), and `Kicked`. The bot creates any of these that don't exist, then adds/removes them from members as their status changes.
- **Team roles — you set these up:** each team has a `discord_role_id` you assign in the **Admin → Team Slots** panel. Create a Discord role per team (so you control its name, color, and hierarchy position) and paste its **role ID** into that team's slot. The bot then assigns/removes that role as players join, move, or leave the team, and **renames the Discord role** when a team is renamed. If a team has no role ID linked, `/syncroles` will fall back to creating a role by the team's name.
- Edits role names/colors, assigns/removes roles from members, strips team roles on a season reset, and `/syncroles` reconciles every player's roles to the database (adds correct ones, removes stale ones).

**Channels & messages**
- Creates a **private match channel** for each matchup (permission-overwritten so only the two teams and the bot can view it) under the configured category, and **deletes** it once the series result is recorded.
- Creates **categories** to organize match channels by round/stage, automatically (created when needed). The draft announcement channel is *designated* by an admin via `/setdraftchannel`.
- **Posts messages** in match channels — schedule proposals, sub requests / accept / reject / escalations, and match results — and **sends DMs** to individual players.

**Moderation**
- **Kick (soft):** adds the `Kicked` role and applies a Discord **timeout**. It does *not* remove the player from the server.
- **Ban:** strips the player's league roles, then **server-bans** them (removes them from the guild). **Unban** lifts the ban so they can rejoin and re-register.

**Access**
- Verifies a user is actually a member of the Discord server before letting them enter a draft or tournament (prompts them to join the server first), and DMs players a confirmation when they register.

> Web push notifications (signup/draft/season events, sub requests) use the browser Push API, **not** Discord — they're independent of the bot.

### Required Discord permissions

Invite the bot with scopes **`bot`** + **`applications.commands`** and these guild permissions:

| Permission | Why it's needed |
|---|---|
| **Manage Roles** | create/edit/assign/remove team & status roles |
| **Manage Channels** | create/delete match channels & categories and set per-channel visibility |
| **Ban Members** | ban / unban players |
| **Moderate Members** | time out players (kick penalty + ban cleanup) |
| **View Channels** · **Send Messages** · **Read Message History** · **Attach Files** | read/post in match channels and accept replay uploads |

**Role hierarchy matters:** drag the bot's role **above** every role it manages (all team roles, `Registered`, `Captain`, `Kicked`) and above any member it must time out or ban. If the bot's role sits below a target, Discord returns `403 Missing Permissions` and the action silently fails (logged server-side).

No **privileged gateway intents** are required — interactions arrive as signed webhooks and member data is read via REST.

### Setup checklist

**Part 1 — Create the bot and add it to the server**

- [ ] Create a Discord **application** and **bot** in the [Developer Portal](https://discord.com/developers/applications).
- [ ] Fill in the Discord env vars: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_REDIRECT_URI`, `ADMIN_DISCORD_IDS` (see [Setup](#setup) below).
- [ ] Add the OAuth2 **redirect URL** (`…/api/auth/discord/callback`) to the application.
- [ ] **Invite the bot** to your server with the scopes and permissions listed above.
- [ ] In **Server Settings → Roles**, move the bot's role to the **top** of the list.
- [ ] Set the app's **Interactions Endpoint URL** to `https://<your-domain>/api/discord/interactions` (use ngrok locally — see below).
- [ ] Register slash commands: `node scripts/register-commands.mjs`.

**Part 2 — Configure within Discord**

- [ ] Seed the first **staff member**: insert a row into `staff_roles` (or use an `ADMIN_DISCORD_IDS` account), then grant others with `/assignrole`.
- [ ] Run `/syncroles`, then `/setdraftchannel` and `/setruleschannel` inside their target channels.
- [ ] Map staff tiers to Discord roles for pings: `/setmoderatorid`, `/setdirectorid`, `/setceoid`.
- [ ] **Set up team roles:** create a Discord role for each team and paste its role ID into the team's slot under **Admin → Team Slots** (slots show "⚠ no role ID set" until linked). Make sure each team role sits **below** the bot's role. (Status roles like `Registered`/`Captain`/`Drafted` are auto-created — only team roles need linking.)

---

## Setup

### Prerequisites
- Node.js 20+
- Supabase project
- Discord application with bot enabled

### Environment Variables

Create a `.env.local` file with the following:

```env
# Discord OAuth
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/discord/callback

# Session
SESSION_SECRET=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Discord Bot
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=

# Admin Discord user IDs (comma-separated) — used for director-level web dashboard access
ADMIN_DISCORD_IDS=
```

### Running Locally

```bash
npm install
npm run dev
```

### Registering Bot Commands

```bash
node scripts/register-commands.mjs
```

Run this from the project root. It reads `.env.local` automatically.

### Discord Interactions Endpoint

Set your app's **Interactions Endpoint URL** in the Discord Developer Portal to:
```
https://your-domain.com/api/discord/interactions
```

For local development, use [ngrok](https://ngrok.com):
```bash
ngrok http 3000
# then set: https://<your-ngrok-url>/api/discord/interactions
```

---

## Deployment

Deployed on Vercel via `vercel --prod`.

Both cron jobs (`/api/cron/draft-autopick` and `/api/cron/tournament-scheduler`) need to run every minute. The Vercel Hobby plan only allows daily crons, so `vercel.json` is set to a daily fallback — **configure an external service** (e.g. [cron-job.org](https://cron-job.org)) to POST to both endpoints every minute with the header `Authorization: Bearer <CRON_SECRET>`. The autopick timer is 45 seconds. The client fires it the moment the deadline passes when anyone has the draft page open; the cron is a fallback for when nobody does.
