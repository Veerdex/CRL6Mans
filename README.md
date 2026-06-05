# CRL 6Mans

Web platform and Discord bot for the CRL West 6mans competitive Rocket League league.

## Discord Bot Commands

All commands marked **[Admin]** require your Discord user ID to be listed in `ADMIN_DISCORD_IDS` in `.env.local`.

---

### Player Info

#### `/totalplayers`
Shows the total number of approved, registered players.

#### `/totalusers`
Shows the total number of users in the system across all statuses (pending, approved, rejected).

#### `/playerinfo <username>`
Looks up a player's full registration info.

| Option | Description |
|--------|-------------|
| `username` | The player's Discord username |

Returns their peak/current 2v2 and 3v3 MMR, calculated rank value, status, and tracker link.

---

### Registration Management — [Admin]

#### `/pending`
Lists all registrations currently waiting for admin review, sorted by submission date.

#### `/approve <username>`
Approves a pending player's registration, granting them access to the full dashboard.

| Option | Description |
|--------|-------------|
| `username` | The player's Discord username |

#### `/reject <username>`
Rejects a pending player's registration.

| Option | Description |
|--------|-------------|
| `username` | The player's Discord username |

---

### Draft — Player

#### `/enterdraft`
Opts yourself into the draft pool. You must be a registered and approved player. Does not happen automatically on approval.

#### `/leavedraft`
Removes yourself from the draft pool.

#### `/draftcount`
Shows the current number of approved players who have entered the draft.

---

### Draft — [Admin]

#### `/setnumteams <count>`
Sets how many teams will be created for the draft.

| Option | Description |
|--------|-------------|
| `count` | A number (e.g. `8`), or `max` to auto-calculate based on approved players (3 players per team) |

#### `/startdraft`
Starts the draft. Requires `num_teams` to be set first via `/setnumteams`. Announces the number of teams and available players.

#### `/draftpool`
Lists all approved players who have not yet been assigned to a team, sorted by rank value. Use this during the draft to see who is available.

#### `/assignteam <player> <team>`
Assigns a player to a team. If the team name doesn't exist yet, it will be created automatically.

| Option | Description |
|--------|-------------|
| `player` | The player's Discord username |
| `team` | The team name |

#### `/enddraft`
Ends the draft and locks all rosters. No further assignments can be made after this.

---

### Season — [Admin]

#### `/startseason`
Officially starts the season. Used after the draft is complete.

#### `/reportresult <team1> <score1> <team2> <score2>`
Records the result of a match between two teams.

| Option | Description |
|--------|-------------|
| `team1` | Name of the first team |
| `score1` | Game score for the first team |
| `team2` | Name of the second team |
| `score2` | Game score for the second team |

Example: `/reportresult team1:Wolves score1:3 team2:Hawks score2:1`

#### `/standings`
Shows the current win/loss standings for all teams, sorted by wins.

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

# Admin Discord user IDs (comma-separated)
ADMIN_DISCORD_IDS=

# Discord Bot
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
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
