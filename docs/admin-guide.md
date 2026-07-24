# Admin Guide — Running a Season on CRL 6Mans

This walks a new staff member through the **Admin dashboard** (`/dashboard/admin`) in the order you'll actually use it — from one-time setup to running a full season to archiving it. It assumes the Discord bot is already connected; if not, do that first (see [README — Discord Bot Setup](../README.md#discord-bot--what-it-does-permissions--setup)).

The dashboard is organized into tabs: **Overview, Players & Staff, Match Ops, Approvals, Season & League, Wagers.** Section names below (e.g. "Team Slots") match the collapsible panel titles you'll see in the UI, so you can find each one by its tab.

Staff tiers — **Moderator → Director → CEO** — gate what you can see and do. Directors and CEOs get the season/league-wide controls (Season & League tab); moderators mainly work Match Ops and Approvals.

---

## 1. One-time setup (do this once per Discord server)

1. **Staff Management** (Players & Staff tab) — grant yourself and other staff a role (moderator/director/CEO). The first CEO has to be seeded via the `staff_roles` table or `ADMIN_DISCORD_IDS` env var — see the README.
2. **Team Slots** (Players & Staff tab, Director+) — create your named team slots (e.g. "Team Alpha") before running any draft, since a draft or auto-balance assigns players *into* these slots. Link each slot to a Discord role ID here so the bot can manage that team's role. Slots persist across seasons — you only redo this if team names/count change.
3. **League Controls** (Season & League tab, Director+) — set the recurring match schedule defaults (deadline day, play day/hour) and MMR floors. These are league-wide defaults, not per-season.

---

## 2. Set up an event: Season vs. Tournament

You have two ways to run an event, both driven from the same underlying draft/match engine:

- **Tournaments** (Season & League tab → **Tournaments**, Director+) — the recommended path. Create a standalone event with its own name, format, and schedule. Supports both individual player sign-ups (with a live snake draft or auto-balance) and pre-formed team sign-ups.
- **Season Settings + League Controls** (Season & League tab, Director+) — the original "main season" toggles (`Draft Signups`, `Start Draft` / `Auto Draft` / `End Draft`, `Start Season`). Still fully functional, and what a Tournament ultimately drives under the hood — use this directly if you just want one long-running season with no separate tournament wrapper.

Most leagues should just use **Tournaments** — it gives you a real lifecycle (scheduled → active → completed) with an archive, whereas the raw League Controls buttons don't track that for you.

### 2a. Creating a Tournament

In **Tournaments**, click **Create** and fill in:

| Field | Notes |
|---|---|
| Name | e.g. "Summer League 2026" |
| Join Mode | **Players (individual)** — people sign up solo and get formed into teams — or **Teams (pre-formed)** — existing teams sign up as a group |
| Team Assignment *(Players mode only)* | **Snake draft (captains pick)** or **Auto-balance by MMR** |
| Format preset | Single/Double Elimination, Group→SE, Group→Swiss→SE, Group→Swiss→Hybrid(12/8), or a qualifier→Swiss→SE variant |
| Min/max teams, best-of per round | Bracket sizing and series length |
| Schedule times | Sign-up open/close, draft start (players mode), stage start times |

The tournament starts in **scheduled** status with sign-ups closed.

### 2b. Running sign-ups

1. Click **Open sign-ups** — players or teams can now join from the website. A push notification goes out to all approved players.
2. Watch the **Registrations & Platform Claims** panel (Approvals tab) for new player registrations that need approving — a player must be `approved` before they can join a draft pool or tournament.
 3. Click **Close sign-ups** once you're ready to lock the roster (optional — you can also just Activate directly).

### 2c. Activating

Click **Activate**. This:
- Checks the sign-up count against your configured minimum (auto-cancels the tournament with a reason if it's short).
- Bridges the sign-up pool into the live runtime (copies entries into the draft pool, mirrors the tournament's config into league-wide settings).

What to do next depends on join mode:
- **Players mode** → go to **League Controls** and click **Start Draft** (live snake draft — team captains pick via the website or `/pick` in Discord) or **Auto Draft** (instantly balances teams by Rank Value). Then **End Draft** to lock rosters.
- **Teams mode** → finalize team rosters, then click **Start Season** directly.

Only one tournament/season can be active at a time.

### 2d. Scheduling rounds

Once active, the **Scheduling** panel (Season & League tab) appears, showing every stage and round. For each round, set either a specific play time or a range/window, plus a deadline. Teams then propose exact times within your window; if they agree on something *outside* it, that shows up under **Schedule Approvals** (Match Ops tab) for you to approve or reject.

**Round 1 of a standalone season requires a manual "Start Round" click** after you've scheduled it and both teams are assigned — this is a deliberate safeguard so you can fix a bad schedule before match channels go live. (Tournament round 1 is gated by team check-in instead, not this flag.)

---

## 3. Running the season week to week

These are the panels you'll return to on a recurring basis:

- **Match Reporting** (Match Ops tab) — report scores for scheduled matches, including per-game replay uploads (auto-parsed for scoreboard stats). Only matches with both teams assigned show up.
- **Sub Requests** (Match Ops tab) — approve/deny substitute requests a team escalated to admin review (usually because the opposing team didn't respond in time).
- **Schedule Approvals** (Match Ops tab) — approve out-of-window match times both teams agreed to.
- **Identity Discrepancies** (Players & Staff tab) — only relevant if platform-account identity enforcement is on; flags replays where the account played doesn't match the expected roster.
- **Profile Change Requests** (Approvals tab) — players requesting to update their tracker URL or MMR; nothing changes until you approve.
- **Players** (Players & Staff tab) — the full roster; kick or ban players here (subject to the staff hierarchy — moderators can only act on non-staff, directors on moderators too, CEOs on anyone), or reverse a ban.
- **Wagers** (Wagers tab) — view/adjust "Westside Wages" (`crl_coins`) balances, individually or in bulk. Fully separate from kicks/bans and from `/admin wipe`.

---

## 4. Wrapping up

When the final match is reported, the app automatically detects the champion and fires a "Season/Tournament Complete!" push notification — you don't need to do anything for that part.

To formally close it out: click **Complete** on the active tournament (Tournaments panel). This snapshots the champion, runner-up, standings, and top stat leaders into the archive, then resets teams/matches for the next event. You can export a PDF recap before or after completing. A **test** tournament (created in testing mode) is discarded instead — no archive, hidden from public views.

Completed events show up in the archive at the bottom of the Tournaments panel, alongside legacy completed seasons.

---

## 5. Reference: Discord slash commands

Day-to-day league running rarely needs Discord commands — the dashboard drives everything. The ones you'll actually reach for:

| Command | When to use it |
|---|---|
| `/syncroles` | Discord roles look wrong (stale team role, missing Registered role) — reconciles all Discord roles to the database. |
| `/diagroles` | A specific player's roles aren't syncing — shows why. |
| `/admin checklist` | Setting up a new server or unsure what's still misconfigured. |

CEO-only, rarely-used commands — see the [README](../README.md#discord-bot-commands) for full details:

| Command | Purpose |
|---|---|
| `/admin resyncmoderation` | Re-applies bans/timeouts/the Kicked role after moving the bot to a **new** Discord server — this state is guild-scoped and doesn't carry over on its own. |
| `/admin disconnect` | Clears all stored Discord channel/role IDs from the database, including deleting team slots (no Discord-side changes) — the first step of a server migration, paired with re-running the setup checklist and `/syncroles`. |
| `/admin wipe` | Clears all season/draft data (matches, drafts) and resets team slots' win/loss record, while keeping the team slots themselves, the Discord connection, and staff roles — for starting a new season. Does **not** touch Westside Wages or existing kicks/bans. |

---

## Troubleshooting

- **"League settings row is missing" banner** — the `league_settings` table has no row yet; click the button in that banner to initialize it. Nothing else will work until this is fixed.
- **A round's channels never opened** — channels auto-create once both teams finish their prior round; `/openround` in Discord is a manual fallback if auto-creation missed one.
- **A Discord role isn't showing up on a player** — run `/syncroles`, or `/diagroles` for a single player's diagnosis.
- **"column … does not exist" errors** — a database migration hasn't been applied; see the README's Database Setup section.
