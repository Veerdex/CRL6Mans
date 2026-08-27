# CRL 6Mans — CLAUDE.md

## What this project is
A competitive Rocket League pickup-queue web app for a college league. Players register via Discord OAuth, enter a draft pool, get snake-drafted or auto-balanced onto teams, and play a tournament season. Admins manage the full lifecycle from the dashboard.

---

## Stack

| Layer | Version / Detail |
|---|---|
| Framework | **Next.js 16.2.7** — App Router, RSC, Server Actions |
| React | 19.2.4 |
| CSS | **Tailwind CSS v4** (PostCSS plugin, `@theme` block in `globals.css`) |
| Database | Supabase (Postgres) via `@supabase/supabase-js` v2 |
| Auth | Discord OAuth2 → HS256 JWT in `session` cookie (`jose`) |
| Bot | Discord slash commands, verified with `tweetnacl` |
| Deploy | Vercel (cron via `vercel.json`) |

### Next.js 16 — critical differences from training data
This is **not** Next.js 13/14/15. APIs, conventions, and file structure differ. Before writing any Next.js code:
- Read `node_modules/next/dist/docs/` for the relevant feature.
- `cookies()`, `headers()`, and `params`/`searchParams` in layouts/pages are **async** — always `await` them.
- `after()` from `next/server` is available for fire-and-forget work after a response is sent (used in the Discord interactions route).
- Server Actions require `"use server"` at the top of the file or function. The body size limit is raised to `5mb` in `next.config.ts` for replay uploads.

### Tailwind v4 — critical differences
- Config is in `globals.css` via `@theme` and `@theme inline` blocks — there is no `tailwind.config.js`.
- All color tokens are CSS custom properties that go through an indirection layer (`--color-*: var(--c-*)`) so themes can swap them at runtime.
- `@utility` is used for one-off helpers like `text-on-accent` and `bg-pure-white`.

---

## Project structure

```
app/
  api/
    admin/                # Internal admin API routes
    auth/discord/         # OAuth2 initiation + callback
    cron/                 # Vercel cron jobs (draft-autopick, tournament-scheduler, clip-reset)
    discord/interactions/ # Discord slash command handler (POST, nacl-verified)
    push/                 # Web push subscription endpoint
  dashboard/
    admin/                # Admin-only pages and server actions
    draft/                # Live draft UI (real-time bracket picks)
    game/                 # Flappy Bird minigame with leaderboard
    my-team/              # Player's own team, schedule, sub requests, series replays
    season/               # Standings, bracket, Swiss view, simulate controls
    settings/             # Profile edits (pending admin approval), theme toggle
    teams/                # All teams grid + admin team editor
    players/              # Full player list
    stats/                # Career leaderboard from player_game_stats (sortable table, MVP rating)
    schedule/             # Match schedule view
    scrims/               # Scrim organization
    tournament/           # Tournament overview page
    test-replay/          # Replay upload and parse tester (admin)
    layout.tsx            # Sidebar + mobile nav, auth guard, nav visibility rules
    nav-link.tsx          # Active-state-aware nav link
    mobile-nav.tsx        # Mobile bottom tab bar + "More" sheet
    page.tsx              # Dashboard home
  lib/
    session.ts            # JWT encrypt/decrypt, createSession/deleteSession
    supabase.ts           # supabase (anon) + supabaseAdmin (service role)
    players.ts            # getPlayerInfo, isAdmin, player CRUD helpers
    discord-api.ts        # Raw Discord REST calls (roles, channels, messages)
    discord-bot.ts        # Slash command handlers, draft/season orchestration
    bracket.ts            # Pure bracket math (seed order, round names, stage IDs)
    bracket-server.ts     # Server-side bracket build + Supabase save
    tournament-runtime.ts # activateTournamentRuntime — bridges tournament → global state
    match-notifications.ts
    replay-parser.ts      # Binary .replay file parser (extracts per-player scoreboard stats)
    ranks.ts              # RL rank tiers
  globals.css             # Tailwind v4 config + all three themes
  layout.tsx              # Root layout — reads theme cookie, sets data-theme on <html>
```

---

## Auth flow

1. `GET /api/auth/discord` — redirects to Discord OAuth, sets `oauth_state` cookie.
2. `GET /api/auth/discord/callback` — exchanges code, fetches Discord user, calls `createSession()`, mirrors saved theme into `theme` cookie, redirects to `/dashboard`.
3. Every protected page/layout calls `decrypt(cookieStore.get("session")?.value)` and redirects to `/login` on null.
4. Session payload: `{ userId: string (Discord snowflake), username, avatar, expiresAt }`.
5. Sessions expire after 7 days.

## Staff hierarchy

Three tiers stored in the `staff_roles` table (`discord_id`, `role`):

| Role | Value | Can act on |
|---|---|---|
| Moderator | `"moderator"` | non-staff players only |
| Director | `"director"` | moderators and non-staff |
| CEO | `"ceo"` | anyone |

Helper functions in `app/lib/players.ts`:
- `getStaffRole(discordId)` — DB lookup, returns `StaffRole | null`
- `isModerator(discordId)` — true for any staff role
- `isDirector(discordId)` — true for director or CEO
- `isCEO(discordId)` — true for CEO only

`ADMIN_DISCORD_IDS` env var is still used for some legacy checks but the DB table is the authoritative source. The `canActOn(actorRole, targetRole)` helper in moderation actions enforces hierarchy server-side; the same logic gates buttons in the UI.

---

## Player lifecycle

```
unregistered → (submits register form) → pending → (admin approves) → approved
                                                  → (admin rejects) → rejected
```

- Only `approved` players can enter the draft, join teams, or access most pages.
- Profile change requests (MMR, tracker URL) go through a separate `player_edit_requests` table and require admin approval.
- Kicked players get a `Kicked` Discord role and a timeout. Banned players are server-banned and must re-register from scratch on unban.
- `removeFromActivePlay(playerId)` — shared helper that clears `team_id`, `is_captain`, `draft_entered`, and `in_active_draft` in one update. Used by kick and ban.

---

## Tournament / draft system

**Tournament states**: `scheduled → active → completed` (or `cancelled`).

**Join modes**:
- `players` — individual players sign up; draft or auto-balance forms teams.
- `teams` — pre-formed teams sign up via `team_signup_members`.

**Team assignment**:
- `snake_draft` — live draft picks shown in `/dashboard/draft`.
- `auto_balance` — server auto-assigns players to balanced teams.

**Activating a tournament** (`activateTournamentRuntime` in `lib/tournament-runtime.ts`):
- Copies `tournament_entries` → `players.draft_entered` to bridge the player pool into the legacy runtime.
- Mirrors tournament config into `league_settings` (single source of truth for the draft/season machinery).
- Idempotent — safe to call mid-draft.

**Cron**: `vercel.json` has `/api/cron/draft-autopick`, `/api/cron/tournament-scheduler`, and `/api/cron/clip-reset` on a daily fallback schedule (`0 0 * * *` — Vercel Hobby plan limit). **Per-minute execution must be configured via an external pinger** (e.g. cron-job.org) hitting all three endpoints with the correct `Authorization: Bearer <CRON_SECRET>` header. The autopick timer is 45 seconds; the client fires it instantly when the deadline passes, so the cron only matters when nobody has the draft page open. `clip-reset` does two independent things on every invocation: (1) archives any clip whose own `expires_at` has passed — each clip's expiry is computed at submission time via `computeClipExpiry` in `app/lib/clip-schedule.ts` as the end of the week *after* the one it was submitted in, guaranteeing at least 7 days regardless of submission day (e.g. a Saturday submission survives 8 days, not <1); and (2) once per week (most recent Sunday 00:00 America/Los_Angeles), crowns the Media tab's Clip of the Week and archives only that winning clip so it stops appearing in the main feed. Both need the per-minute pinger since expiries land on different days for different clips.

**Tournament scheduler** also fires push notifications on key lifecycle events: signups open/close, draft start, season start.

## Rank Value (RV) / rating model

RV is a player's rating under the `crl-final-rating-v1` model. **`app/lib/rating.ts` is the single source of truth** for the formula — do not restate it here; read that file instead. It's a pure, side-effect-free module shared by the season updater (`app/lib/discord-bot.ts`) and the wager predictor (`app/dashboard/wagers/prediction.ts`), so both interpret ratings identically.

Every call site should go through `playerRatingFromRow()` (player rating from a DB row), `initialTeamRating()` (roster → team rating), and `resolveTeamRating()` (stored `season_rating` if present, else `initialTeamRating`) — never hand-roll the field mapping or the fallback logic locally. 1v1 MMR is **not** part of the rating model; only 2v2/3v3 peak and season MMR feed it. 1v1 fields still exist in the schema/UI for other purposes (registration, profile edits) but are ignored by the rating math.

`teams.season_rating` is the live rating that moves with match results; `teams.initial_rating` is the fixed anchor a team started at, used by `applyFormRetention()` to pull `season_rating` back toward it before each match's update. Both are lazy-initialised together on a team's first rated match, and `applySeasonRatingUpdate` in `discord-bot.ts` is the only place either gets written from a match result — `applyPlayerRVChangeToTeamRating` (roster/MMR edits) shifts both by the same delta so an edit isn't mistaken for match-driven form.

---

## Captain rules

- Captain is the **highest-RV player** on the team.
- A team with **≤2 players has no captain** — that is not a full roster.
- Captain is **stable for the season** — MMR changes do not trigger reassignment.
- When the captain is **removed or moved off the team**, the team becomes captainless. No automatic promotion.
- When a player is **added to a captainless team** with 3+ members, `assignCaptainIfMissing` (in `app/dashboard/teams/actions.ts`) assigns the highest-MMR player as captain.
- `removeFromActivePlay` always clears `is_captain: false` so kick/ban never leaves stale captain state in the DB.

---

## Push notifications

Web push via the `push_subscriptions` table. Helper functions in `app/lib/push.ts`:
- `pushToAllApproved(payload)` — all approved players
- `pushToAdmins(payload)` — staff only (checks `staff_roles`)
- `pushToEnteredDraft(payload)` — players with `draft_entered: true`

Used in tournament-scheduler cron and admin web actions for signup open/close, draft start, and season start events.

**Event completion notification** (`execReportMatchResult` in `app/lib/discord-bot.ts`): fires automatically on the **final reported match** — `Season Complete!` for a season, or `Tournament Complete!` (with the tournament name) when `league_settings.active_tournament_id` is set. The champion is the winner of that match. Detection requires two conditions so it never fires mid-event:
- The reported match is in a **terminal stage**: `single_elimination` (SE final), `de_grand_final`, `hybrid_gf`, or `hybrid8_gf`. Group/Swiss/qualifier matches are non-terminal, so the "0 scheduled matches" lull between stages (next stage not yet generated) can't trigger it.
- **No scheduled matches remain** (both teams assigned). For a DE grand final, a lower-bracket win schedules the reset match *before* this check (`advanceBracketWinner` runs first), so the count stays > 0 until the bracket is truly decided.

`completeTournament` (the admin archival step) does **not** send a push — completion is driven solely by the final match. All current format presets culminate in one of the terminal stages above; a format without one would not trigger this notification.

---

## Discord bot

- Endpoint: `POST /api/discord/interactions` — Ed25519-verified with `tweetnacl`.
- Deferred commands (long-running): acknowledged immediately, result sent via `followUp()` using `after()` so the handler can exceed the 3-second Discord limit.
- `DEFERRED_COMMANDS = ["openround", "score", "syncroles"]` — only commands with actual implementations that take >3s. Auction draft commands (`nominate`, `bid`, `endround`, `budget`) are commented out in `register-commands.mjs` and excluded from `DEFERRED_COMMANDS`; their handler code is preserved for future use.
- All slash command logic lives in `app/lib/discord-bot.ts`.

---

## Theme system

Three themes: `crl6mans` (default), `dark`, `light`.

**How it works**: `globals.css` defines a `@theme` block that maps every Tailwind color token (`--color-amber-400`) to an indirection var (`var(--c-amber-400)`). Each theme block (`html[data-theme="dark"]` etc.) sets the `--c-*` values. Swapping `data-theme` on `<html>` re-tokens the entire app instantly.

**Persistence**: `setTheme()` server action writes to both the `theme` cookie (no-flash SSR) and the `players` table (source of truth). The theme cookie is mirrored on login in the OAuth callback.

**CRL6Mans theme design**:
- Sidebar: hardcoded blue `#3736ac` (not via tokens).
- Content area primary/buttons: orange `#e88a24` via `--c-indigo-*` remapped to the orange ramp.
- Headings (`main h1, h2`): orange `#e88a24`.
- Active nav item: solid orange pill.
- Brand colors: Orange `#e88a24`, Blue `#3736ac`, White `#ffffff`.

**Utilities**: `text-on-accent` (always white, for text on colored bg) and `bg-pure-white` (always white) are defined via `@utility` and beat Tailwind's layered utilities.

---

## Key database tables (inferred from queries)

| Table | Purpose |
|---|---|
| `players` | One row per Discord user; holds status, MMR, theme, draft_entered, is_captain, team_id |
| `teams` | Draft-formed or pre-formed teams |
| `league_settings` | Single-row global config (draft_open, draft_active, season_active, num_teams) |
| `tournaments` | Tournament records with status, join_mode, format, dates |
| `seasons` | Archive of completed manual seasons (name with year, summary champion/runner-up/standings, format, team_count, dates) — mirrors `tournaments.summary` |
| `tournament_entries` | Player sign-ups for player-mode tournaments |
| `team_signup_members` | Player membership in team-mode sign-up groups |
| `player_edit_requests` | Pending MMR/tracker change requests awaiting admin approval |
| `matches` | Season/tournament match results |
| `sub_requests` | Substitute player requests |
| `series` | Best-of series between teams |
| `staff_roles` | `discord_id` + `role` (`moderator`/`director`/`ceo`) — source of truth for staff permissions |
| `push_subscriptions` | Web push endpoints for browser notifications |
| `player_game_stats` | Per-player, per-game scoreboard stats (goals/assists/saves/shots/score) parsed from submitted series replays |
| `clips` | Media tab clip submissions (YouTube/medal.tv/Streamable); `archived_at` marks past weeks instead of deleting |
| `clip_likes` | One row per (clip, player) like on the Media tab |

---

## Environment variables

```
SESSION_SECRET                   # HS256 JWT signing key (32+ random bytes)
NEXT_PUBLIC_SUPABASE_URL         # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY    # Supabase anon/public key
SUPABASE_SERVICE_ROLE_KEY        # Supabase service role key (server-only)
DISCORD_CLIENT_ID                # OAuth2 application ID
DISCORD_CLIENT_SECRET            # OAuth2 secret
DISCORD_REDIRECT_URI             # Must match Discord app settings exactly
DISCORD_BOT_TOKEN                # Bot token for REST API calls
DISCORD_PUBLIC_KEY               # Ed25519 public key for interaction verification
DISCORD_GUILD_ID                 # The server/guild this league runs in
ADMIN_DISCORD_IDS                # Comma-separated Discord snowflakes for admins
```

---

## Running locally

```bash
npm run dev      # starts Next.js dev server on :3000
```

The Discord OAuth redirect must point to `http://localhost:3000/api/auth/discord/callback` in both the Discord app settings and `DISCORD_REDIRECT_URI`.

Cron jobs (`/api/cron/*`) do not run locally — test them by hitting the route directly with the correct `Authorization: Bearer` header.

---

## Conventions

- **All DB access uses `supabaseAdmin`** (service role) from server components and server actions. The anon client (`supabase`) is available but rarely used.
- **Server actions** live in `actions.ts` files co-located with their page and always begin with `"use server"`.
- **Auth guard pattern**: every protected page calls `decrypt(...)` at the top; redirect to `/login` on null session, redirect to `/dashboard` if status check fails.
- **No comments unless the why is non-obvious.** Well-named identifiers are the docs.
- **No error handling for impossible cases.** Trust internal guarantees; only validate at system boundaries.
- **"cpd"** is shorthand the user uses for "commit, push, deploy" — do the full sequence when asked for it.
