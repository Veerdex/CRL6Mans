# CRL 6Mans — CLAUDE.md

## What this project is
A web app running drafted Rocket League seasons for college players. Players register via Discord OAuth, enter a draft pool, get snake-drafted or auto-balanced onto teams, and play a tournament season. Admins manage the full lifecycle from the dashboard.

It is **not** a pickup queue, and no user-facing copy should call it one — that is the separate private 6mans bot in the same Discord (`crl6mansqueuebot_*` tables). The app is also unaffiliated with Psyonix's official Collegiate Rocket League, whose Western Conference it shares both a name and an eligibility boundary with (schools west of the Mississippi), so About and Welcome carry a disclaimer and nothing calls the league "collegiate".

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
This is **not** Next.js 13/14/15. APIs, conventions, and file structure differ. Before writing any Next.js code, read `node_modules/next/dist/docs/` for the relevant feature.
- `cookies()`, `headers()`, and `params`/`searchParams` in layouts/pages are **async** — always `await` them.
- `after()` from `next/server` is available for fire-and-forget work after a response is sent (used in the Discord interactions route).
- Server Actions require `"use server"` at the top of the file or function. The body size limit is raised to `5mb` in `next.config.ts` for replay uploads.

### Tailwind v4 — critical differences
- Config is in `globals.css` via `@theme` and `@theme inline` blocks — there is no `tailwind.config.js`.
- Color tokens are CSS custom properties behind an indirection layer (`--color-*: var(--c-*)`) so themes can swap them at runtime.
- `@utility` is used for one-off helpers like `text-on-accent` and `bg-pure-white`.

---

## Project structure

```
app/
  api/            admin/ · auth/discord/ (OAuth2) · cron/ · discord/interactions/
                  (slash commands, nacl-verified) · push/
  dashboard/      admin/ draft/ game/ media/ my-team/ players/ schedule/ scrims/
                  season/ settings/ stats/ subs/ teams/ test-replay/ wagers/
                  + about/ help/ notifications/ podium/ register/ rules/ sponsors/
                  support/ welcome/
    layout.tsx    # Sidebar + mobile nav, auth guard, nav visibility rules
  lib/
    session.ts            # JWT encrypt/decrypt, createSession/deleteSession
    supabase.ts           # supabase (anon) + supabaseAdmin (service role)
    players.ts            # getPlayerInfo, isAdmin, staff-role helpers, player CRUD
    discord-api.ts        # Raw Discord REST calls (roles, channels, messages)
    discord-bot.ts        # Slash command handlers, draft/season orchestration
    bracket.ts            # Pure bracket math (seed order, round names, stage IDs)
    bracket-server.ts     # Server-side bracket build + Supabase save
    tournament-runtime.ts # activateTournamentRuntime — tournament → global state
    match-notifications.ts # notifyMatchChannel — posts a ChannelPost to a match channel
    replay-parser.ts      # Binary .replay file parser (per-player scoreboard stats)
    ranks.ts              # RL rank tiers
  globals.css             # Tailwind v4 config + all three themes
  layout.tsx              # Root layout — reads theme cookie, sets data-theme on <html>
```

**Pure leaf modules** in `app/lib/` have no Supabase import so `node --test` can load them: `draft-order.ts`, `draft-embeds.ts`, `match-embeds.ts`, `clip-embeds.ts`, `series-report.ts`, `forfeit-vote.ts`, `rating.ts`, `team-size.ts`, `clip-schedule.ts`, `admin-notification-prefs.ts`. Tests: `npm run test:draft-order`, `test:draft-embeds`, `test:match-embeds`, `test:series-report`, `test:forfeit-vote`.

---

## Discord message conventions

Every message the bot posts is an embed built in a pure leaf module — `app/lib/draft-embeds.ts`, `app/lib/match-embeds.ts`, `app/lib/clip-embeds.ts`. Nothing else should format one. These rules apply to all of them:

- **A mention inside an embed notifies nobody.** Pings live in the message `content`; a mention inside an embed is only a way of *drawing* a name as a role chip (the match intro's `vs` line does this). This is why the draft start announcement is two messages.
- A ping absent from `allowed_mentions.roles` is **stripped silently** — no type error, no failing test — so `content` and the whitelist must be generated together. Builders therefore return one `ChannelPost` (`{ content, embeds, allowed_mentions }`), and `notifyMatchChannel(matchId, post)` takes the whole bundle.
- **An over-long part 400s the whole message** instead of truncating. Clamp free text (an admin's rejection reason, a sub reason, a round's schedule lines) into `description` or a field `value`, and chunk long lists across fields at Discord's 1024-character limit.
- `<t:…>` and `**bold**` render only in `description` and field values — never in a footer or a title.
- Player-supplied text must never reach `content` unguarded. The clip crowning ping uses `allowed_mentions: { parse: [], roles: [roleId] }` because a clip title would otherwise ping the server through the bot.

**Match channels:** resolve **every** ping through `teamPing(name, roles)`, never a local `roles.find(r => r.name === …)`. It returns **null** when no role matches rather than a bolded fallback, so `content` ends up containing zero player-supplied text (the name is already in the embed; `teamLabel` is the bold fallback *inside* an embed). It is also the one place the `@everyone` guard lives — `GET /guilds/{id}/roles` returns that role under its literal name and `getGuildRoles` does not filter it, so a team named `@everyone` would ping the whole server. That is why `roleMention`/`roleMentionByName` are gone, and why `createMatchChannel` routes its intro pings through `teamPing` even though it has already resolved the roles for the channel overwrites. The test suite enforces the direction: every role drawn inside an embed must also be pinged in the content, and no embed may carry `@everyone`, `@here` or a user mention.

---

## Auth flow

1. `GET /api/auth/discord` — redirects to Discord OAuth, sets `oauth_state` cookie. Sends `prompt=none` so a returning player never sees the authorize screen again, plus an `oauth_silent` cookie marking the attempt as silent. Discord **errors instead of prompting** when it can't be silent (never authorized, revoked, or not signed in to Discord in that browser), so the callback retries a failed silent attempt at `?consent=1`, which omits `prompt` and clears the cookie. Without that retry a first-time player dead-ends on `/login?error=cancelled`.
2. `GET /api/auth/discord/callback` — exchanges code, fetches Discord user, calls `createSession()`, mirrors saved theme into the `theme` cookie, redirects to `/dashboard`.
3. Every protected page/layout calls `decrypt(cookieStore.get("session")?.value)` and redirects to `/login` on null.
4. Session payload: `{ userId: string (Discord snowflake), username, avatar, expiresAt, sessionVersion, authTime }`.
5. **Sessions slide.** A token lasts 7 days and `proxy.ts` re-issues it once past the midpoint, so an active player is never signed out mid-use. `authTime` records the last real Discord authentication and is carried through renewals unchanged, capping the chain at `SESSION_MAX_AGE_MS` (30 days). **That cap is load-bearing:** the OAuth callback is the only writer of `accounts.mfa_enabled`, which gates the admin panel, and the only thing that refreshes the username and avatar the token carries — so unbounded renewal would let a staff member who turned off Discord 2FA keep admin access forever. Past the cap the token is simply not renewed; it is not treated as revoked.
6. Renewal is also where **ban/kick revocation fires**: `renewSession` calls `verifySessionCurrent` before extending, and a `session_version` mismatch clears the cookie. Per-renewal rather than per-request keeps it to one query every few days per player, so revocation lands within the renewal interval rather than instantly.

## Staff hierarchy

Three tiers stored in the `staff_roles` table (`discord_id`, `role`):

| Role | Value | Can act on |
|---|---|---|
| Moderator | `"moderator"` | non-staff players only |
| Director | `"director"` | moderators and non-staff |
| CEO | `"ceo"` | anyone |

Helpers in `app/lib/players.ts`: `getStaffRole(discordId)` (returns `StaffRole | null`), `isModerator` (any staff role), `isDirector` (director or CEO), `isCEO`.

`ADMIN_DISCORD_IDS` is still used for some legacy checks but the DB table is authoritative. `canActOn(actorRole, targetRole)` in the moderation actions enforces the hierarchy server-side; the same logic gates the buttons.

---

## Player lifecycle

```
unregistered → (submits register form) → pending → (admin approves) → approved
                                                  → (admin rejects) → rejected
```

- Only `approved` players can enter the draft, join teams, or access most pages.
- **Registration collects a tracker URL, enrollment proof and sub availability — no MMR.** The join confirmation popup is where ranks are entered, so they're read off a tracker when they matter. The MMR columns are `text not null default '0'` on both tiers, so a player who has never confirmed sits at `'0'`, which `calculatePlayerRating` would read as the league's weakest player rather than as unknown. `hasMmrOnFile` in `app/lib/mmr-on-file.ts` is therefore the gate on **every** join path — `enterDraft`, `joinTournament`, `createTeam`, `respondInvite` — and the test is **both all-time peaks zero**, since a season peak of 0 is ordinary after a reset and one playlist's all-time peak can genuinely be 0. The ask sits **ahead** of the min-MMR gate, or a first-timer would be refused on zeros they never had a chance to replace; `getOwnMmrForJoin` returns **blank** rather than `"0"` for such a player, because a prefilled 0 is confirmable without reading anything.
- Tracker URL changes go through `player_edit_requests` and need admin approval. MMR is self-service — `requestProfileChange` writes it straight to Tier 2 + Tier 3 and propagates the RV delta to the player's team. The request table's MMR columns are `not null` legacy baggage: a request carries the live values and approval ignores them.
- Kicked players get a `Kicked` Discord role and a timeout. Banned players are server-banned and must re-register from scratch on unban.
- `removeFromActivePlay(playerId)` clears `team_id`, `is_captain`, `draft_entered`, and `in_active_draft` in one update. Used by kick and ban.

---

## Tournament / draft system

**States**: `scheduled → active → completed` (or `cancelled`).

**Join modes**: `players` (individuals sign up; draft or auto-balance forms teams) or `teams` (pre-formed teams sign up via `team_signup_members`).

**Team assignment**: `snake_draft` (live picks in `/dashboard/draft`) or `auto_balance` (server assigns balanced teams).

### Team size (`tournaments.team_size`, 1–3; seasons are always 3)
- Every consumer reads `league_settings.team_size` through `app/lib/team-size.ts` (`normalizeTeamSize` / `resolveTeamSize`) — never a local `?? 3`. `activateTournamentRuntime` mirrors it in, and every teardown resets it to `DEFAULT_TEAM_SIZE` so a 1v1 can't size the next season's draft.
- 3v3 has two pick rounds and the snake balances them, so the highest-RV captain picks first. 2v2 has a single round with nothing to reverse against, so the order flips and the **worst** captain picks first.
- **1v1 has no draft at all** — a team is its own captain. Both `sanitize()` in `admin/tournament-actions.ts` and `execStartDraft` reject it.

### Pick order and draft messages
- Pick order lives in `app/lib/draft-order.ts`. Captains are seated before pick 0, so `totalDraftPicks` = `num_teams × (team_size - 1)`. `getTeamNumberForPick` is fixed snake math; the order is really decided by `captainSeatOrder`, which maps RV rank onto team slots.
- **A pick is one message, not two.** The on-the-clock message is edited into the result when the pick lands, so the channel reads as one line per pick. `league_settings.draft_pick_message_id` holds the message on the clock; `rememberPickMessage` writes it, and it is released in the same update that advances `current_pick` so a racing autopick can't overwrite the winner's announcement.
- A timeout is the same edit in amber (`pickEmbed({auto: true})`), not a separate post — so a timed-out pick that then fails leaves the message reading as still on the clock. If the edit fails the result is posted instead. `setDraftChannelVisibility(false)` clears the stored ID, since a stale one would rewrite a message in the previous draft's history. The column read degrading to `undefined` is the pre-migration fallback: every pick posts its own message, as before.

### Draft channel visibility
`setDraftChannelVisibility(open)` in `discord-bot.ts` flips the event role's VIEW_CHANNEL overwrite on `draft_channel_id` (`setChannelRoleView` in `discord-api.ts`, `PUT /channels/{id}/permissions/{roleId}`).
- Open in `execStartDraft` **before** the start message, since Discord drops a mention's notification in a channel the member can't see yet.
- Close on **every** path that ends a draft — `execEndDraft`, `completePick` on the last pick, both of `execAutoPick`'s terminal guards, `adminWipe`, `resetSeason`, `forceResetDraftState`. The overwrite lives in Discord, not the DB, so a missed close leaves the channel open to whoever holds the event role next.
- Closing writes an **explicit deny** rather than deleting the overwrite, so the channel keeps the permission shape an admin set up by hand, and it denies every ID from `tournamentRoleIdsToStrip()` — relinking the role mid-draft would otherwise strand the overwrite the channel was opened on.

### Activating a tournament
`activateTournamentRuntime` in `lib/tournament-runtime.ts`:
- Copies `tournament_entries` → `players.draft_entered` to bridge the player pool into the legacy runtime.
- Mirrors tournament config into `league_settings` (single source of truth for the draft/season machinery).
- Idempotent — safe to call mid-draft.

### Event completion notification
`execReportMatchResult` fires it on the **final reported match** — `Season Complete!` for a season, or `Tournament Complete!` (with the name) when `league_settings.active_tournament_id` is set. The champion is the winner of that match. Two conditions, so it never fires mid-event:
- The match is in a **terminal stage**: `single_elimination` (SE final), `de_grand_final`, `hybrid_gf`, or `hybrid8_gf`. Group/Swiss/qualifier matches are non-terminal, so the "0 scheduled matches" lull between stages can't trigger it.
- **No scheduled matches remain** (both teams assigned). For a DE grand final a lower-bracket win schedules the reset match *before* this check (`advanceBracketWinner` runs first), so the count stays > 0 until the bracket is truly decided.

`completeTournament` (the admin archival step) sends **no** push — completion is driven solely by the final match. All current format presets culminate in a terminal stage above; a format without one would not trigger this.

---

## Test events

**Test tournaments** (`tournaments.is_test`) are staff-only, gated through `app/lib/test-tournament.ts`. Non-moderators don't see them on the dashboard, the detail view, or in join/sign-up actions. While one is active, the event tabs (My Team, Teams, Draft, Season, Schedule) are hidden for non-moderators even against nav overrides, their pages redirect via `redirectIfTestTournamentHidden()`, and Wagers drops to the leaderboard-only view.

### What `testTournament: true` on a push payload does

Push helpers live in `app/lib/push.ts`; subscriptions in `push_subscriptions`.

| Helper | Effect | Why |
|---|---|---|
| `pushToAllApproved` | **Suppressed** — records under `test_tournaments`, sends nothing | A test event is not news to the league. **Never inferred**, since the same helper carries real league-wide announcements that must keep going out during a test — so a caller sets it explicitly, or the test announces itself to every approved player. |
| `pushToAdmins` under an `EVENT_ADMIN_CATEGORIES` category (`match_disputes`, `sub_requests`, `schedule_approvals`) | **Inferred** → `pushToTestTournamentAdmins` | A moderator not running the test shouldn't be paged about a fake match. |
| `pushToTeam`, `pushToEnteredDraft`, `pushToRosteredPlayers`, `pushToTournamentEntrants`, `pushToTournamentRoster`, `pushToDiscordIds`, `pushToUser` | **Ignored — delivers normally** | An event-scoped audience is made of that event's own participants, so containment comes from who was rostered. Redirecting instead turned a per-player check-in notice into one per match per side for whoever held the toggle. |

`pushToTestTournamentAdmins` is **opt-in** — it delivers only when the `test_tournaments` admin notification toggle is explicitly on. That is the one default-**off** entry in `app/lib/admin-notification-prefs.ts`, the pure leaf that `push.ts`, `notifications.ts`, `setAdminNotificationPref` and the toggles UI all read, so the drawn state, the value a click writes, the send gate and the feed filter can't disagree. Recipients are `staff_roles` ∪ `DEVELOPER_DISCORD_IDS` (a developer resolves as CEO without a `staff_roles` row). It is terminal on purpose: routing through `pushToAdmins` would re-enter its own test branch and recurse.

The two unflagged `pushToAllApproved` sites (`league-actions.ts` "Season Signups Open", `discord-bot.ts` "Season Complete!") are manual-season paths, part of the `is_test_season` gap below.

### Stats containment
**A test event's stats never become permanent.** `resetSeason` skips `rollUpCareerStats()` when `isTestEventActive()`, and the matches delete that follows discards the rows through the `player_game_stats.match_id` cascade. The check belongs there rather than in `completeTournament` because every way an event ends passes through `resetSeason`: Complete Tournament, Cancel Tournament on an active one, the manual Reset Season button, and `completeSeason`'s `is_test_season` branch. `player_career_stats` is permanent and has no event column, so a fold cannot be undone once the source rows are consumed.

For the same reason `fetchAllTimeTotals` excludes the live rows during a test event — for staff too, since All Time is the permanent record and a test's numbers are real only under Current Event. The Stats page's Current Event toggle and the Players page's list and stat columns are staff-only while a test tournament runs; neither page is an event tab, so the nav hiding doesn't cover them.

### Discord side and known gaps
The Discord side isn't gated by `is_test` and doesn't need to be: `createTextChannel` denies `@everyone` VIEW_CHANNEL and allows only the team roles passed to it, the draft channel is role-gated by `setDraftChannelVisibility`, and every match-channel ping resolves through `teamPing`. A test event's channels and pings reach only members holding its team roles — so **rostering a real player onto a test team is the one thing that puts a test event in front of them.**

`is_test_season` on a manual season is a **separate flag with separate coverage.** The stats containment above honours it and `completeSeason` discards the season's archive, but nothing hides a test season's pages and no push helper infers it, so players still see one running.

---

## Cron

`vercel.json` has five jobs on a daily fallback schedule (`0 0 * * *` — Vercel Hobby plan limit): `/api/cron/draft-autopick`, `/api/cron/tournament-scheduler`, `/api/cron/clip-reset`, `/api/cron/patreon-sync`, `/api/cron/discord-sync`.

**Per-minute execution must be configured via an external pinger** (e.g. cron-job.org) hitting the endpoints with the correct `Authorization: Bearer <CRON_SECRET>` header — **the first three only**. `patreon-sync` and `discord-sync` are daily-only by design: patron status and a Discord username/avatar can each be a day stale without anyone noticing.

The autopick timer is 45 seconds; the client fires it instantly when the deadline passes, so the cron only matters when nobody has the draft page open. `tournament-scheduler` also fires push notifications on signups open/close, draft start and season start.

### `clip-reset`
Two independent things on every invocation, both needing the per-minute pinger since expiries land on different days for different clips:
1. Archives any clip whose own `expires_at` has passed. Each clip's expiry is computed at submission via `computeClipExpiry` in `app/lib/clip-schedule.ts` as the end of the week *after* the one it was submitted in, guaranteeing at least 7 days regardless of submission day (a Saturday submission survives 8 days, not <1).
2. Once per week (most recent Sunday 00:00 America/Los_Angeles), crowns the Media tab's Clip of the Week and archives only that winning clip so it stops appearing in the main feed.

The crowning announcement is built in `app/lib/clip-embeds.ts` (see Discord message conventions).
- `clips.clip_of_week_number` is a running count that never resets, stored on the winning clip so past winners keep their number. A read error on that column means the migration hasn't been run, and the heading drops the week rather than failing the update that archives the winner.
- The embed's image never comes from `clips.thumbnail_url` — that column is only populated for the link-only platforms, which are exactly the ones barred from winning, so it is null for every possible winner. YouTube resolves offline through `clipPreviewImageUrl` (pure, from the video ID); Medal, Streamable and Twitch fall through to `fetchClipThumbnail`, which scrapes `og:image` because Medal's oEmbed endpoint is gone (410). Discord proxies the image when the message posts.
- **That scrape must stay on the crowning path, not the submission path**: Medal's `og:image` is a signed CDN URL that expires in about a day (the unsigned URL 403s) and a clip can sit in the pool for over a week, so a URL captured at submission is always dead by the time it wins.

---

## Rank Value (RV) / rating model

RV is a player's rating under the `crl-final-rating-v1` model. **`app/lib/rating.ts` is the single source of truth** for the formula — do not restate it here; read that file. It is a pure module shared by the season updater (`app/lib/discord-bot.ts`) and the wager predictor (`app/dashboard/wagers/prediction.ts`), so both interpret ratings identically.

Every call site should go through `playerRatingFromRow()`, `initialTeamRating()` (roster → team rating), and `resolveTeamRating()` (stored `season_rating` if present, else `initialTeamRating`) — never a hand-rolled field mapping or fallback. 1v1 MMR is **not** part of the model; only 2v2/3v3 peak and season MMR feed it. 1v1 fields still exist in the schema and the admin player editors (for legacy stored values) but are no longer collected and are ignored by the math.

`teams.season_rating` is the live rating that moves with match results; `teams.initial_rating` is the fixed anchor a team started at, used by `applyFormRetention()` to pull `season_rating` back toward it before each match's update. Both are lazy-initialised together on a team's first rated match. `applySeasonRatingUpdate` in `discord-bot.ts` is the only place either is written from a match result — `applyPlayerRVChangeToTeamRating` (roster/MMR edits) shifts both by the same delta so an edit isn't mistaken for match-driven form.

---

## Captain rules

- Captain is the **highest-RV player** on the team.
- A team **below its full roster size has no captain** — that is not a full roster. Roster size is `league_settings.team_size` (see `app/lib/team-size.ts`).
- Captain is **stable for the season** — MMR changes do not trigger reassignment.
- When the captain is **removed or moved off the team**, the team becomes captainless. No automatic promotion.
- When a player is **added to a captainless team** that is now at full roster size, `assignCaptainIfMissing` (in `app/dashboard/teams/actions.ts`) assigns the highest-MMR player as captain.
- `removeFromActivePlay` always clears `is_captain: false` so kick/ban never leaves stale captain state.

---

## Discord bot

- Endpoint: `POST /api/discord/interactions` — Ed25519-verified with `tweetnacl`. All slash command logic lives in `app/lib/discord-bot.ts`.
- Deferred commands are acknowledged immediately and answered via `followUp()` using `after()`, so the handler can exceed Discord's 3-second limit.
- `DEFERRED_COMMANDS = ["openround", "postclip", "profile", "stats", "coins", "sub", "approve", "reject", "dispute", "report", "forfeit"]` — commands that take >3s, plus the ones whose reply should be private: **deferring forces the reply ephemeral**, so a command answering publicly must stay out of the set. `syncroles` is deferred as an `/admin` subcommand instead (`DEFERRED_ADMIN_SUBCOMMANDS`).
- Auction draft commands (`nominate`, `bid`, `endround`, `budget`) are commented out in `register-commands.mjs` and excluded; their handler code is preserved for future use.

### Where the match commands can be run

`/report`, `/dispute`, `/forfeit`, `/approve`, `/reject`, `/checkin` and `/sub` work **only inside a match's own channel**.

- `decidableMatches` resolves the match from `matches.discord_channel_id` and refuses anywhere else. It deliberately does **not** fall back to the team's open matches — a team with one match left would then succeed from the lobby, which is what the scoping exists to stop.
- `/checkin` resolves the same way inline. Its query also pins `status = "scheduled"`, so a miss means "not a match channel" *or* "match already under way" and its wording has to read true for both.
- `/sub` is gated on `decidableMatches` purely for the channel check — its core still picks the team's next match, not the channel's. That costs `/sub` something the other six never had, since a sub is usually wanted *ahead* of the match: a tournament channel only opens with the check-in window, so **My Team is the surface for requesting one earlier**. A season's channel opens with the round and stays up for it, so there's no such pinch.
- Because scope is exactly one match and `submitSubRequestCore` permits one active sub request per team, every "more than one waiting" branch became unreachable and is gone. The deliberate cost: a match whose channel failed to open or was deleted can't be decided from Discord at all — My Team is the surface for that.

**This replaces a hand-maintained Discord allowlist and depends on the Discord side staying open.** Editing per-command channel permissions needs a **Bearer** token with `applications.commands.permissions.update` from a guild admin — a bot token errors — so the bot can't maintain that list as match channels come and go. The match commands are therefore set to **All Channels** in Server Settings → Integrations, with the code as the only gate. Narrowing them back to specific channels, or resetting the integration-wide default to none, silently kills them in every match channel. `/pick` is the exception that still rides a Discord-side override, because the draft channel is long-lived.

### Series reporting — `/report` and its cores

The My Team reporting panel and the bot run the **same cores** — `submitSeriesResultCore`, `confirmSeriesResultCore`, `cancelSeriesSubmissionCore`, `disputeSeriesResultCore`, `castForfeitVoteCore`. They live in `discord-bot.ts` rather than a module of their own because `series-actions.ts` already imports `finalizeAcceptedSeries` from it.

- Each takes an `actorDiscordId`, because a server action reads the session cookie and the bot has none.
- **None may be exported from a `"use server"` file** — every export there is a callable endpoint.
- Their returned prose is **surface-neutral**, naming no command and no page, since both surfaces show it verbatim. `scripts/test-series-report.ts` pins that.

Which half of `/report` applies depends on `isStatsTrackingEnabled()`: stats off takes a typed `won`/`lost`, stats on takes `game1..game7` replay attachments and derives the score from them.

- **Every option is optional** — Discord cannot make one conditionally required, and a required option must precede the optional ones — so `modeMismatch` in `app/lib/series-report.ts` (the pure leaf holding every validation) tells a team which half they're in. `opt()` returns `""` for an absent option, so presence is checked rather than read: `Number(opt(i, "lost"))` is a confident `0`.
- The analyse/persist split in `app/lib/replay-analysis.ts` (`analyzeGameReplay` / `persistGameAnalysis`) exists so `/report` can validate the whole series before committing any of it, leaving no certification rows behind on a rejection. The website keeps per-slot persist because nothing later can reject a slot.
- `/report` also checks for a duplicate `replayId` **within** the series — `analyzeGameReplay` only looks across other matches, so the same file in `game1` and `game2` would otherwise count a win it never earned.
- An attachment option is type 11 and carries only the attachment's ID; `filename`, `size` and the signed CDN URL arrive in `interaction.data.resolved.attachments`. That URL is fetched outbound, so a replay never passes through a request body and the site's 4.2 MB cap (Vercel's body limit) doesn't apply — `reportCmd` applies it anyway, for parity rather than platform.
- **Strict mode diverges deliberately between the surfaces.** On the website an unmatched replay player is accepted and an admin resolves it after both teams accept; `/report` **rejects at report time**, because the reporter is still at the keyboard and can fix a tracker, whereas by review time nobody is. In loose mode both surfaces accept, and `seriesSubmittedPost` warns the other team in the channel that the replays may be invalid.

### Giving a match up — the Forfeit button and `/forfeit`

`castForfeitVoteCore` is shared by My Team's Forfeit button and `/forfeit`. It takes **two players** (one at 1v1), and `forfeitVotesRequired` in `app/lib/forfeit-vote.ts` (the pure leaf, with `forfeitBlocked` and `forfeitScore`) is the only place that threshold is decided.

- A vote is a **row** in `match_forfeit_votes`, PK `(match_id, player_id)`, so a second press is idempotent. Withdrawing is an explicit flag (`/forfeit withdraw:True`, or the button flipping to "Withdraw forfeit vote") and **never** what a repeat press does — a deferred reply is ephemeral and slow enough that a player re-runs the command, and a toggle would answer that by quietly taking their vote back.
- Votes count against the team's **current roster**, not the rows' own `team_id`, so a player moved off the team after voting stops counting. `team_id` on the row is audit-only.
- **Every gate lives in the core**, not the surfaces: `forfeitBlocked` (both teams seated, match not final, no pending submission from either side), `isScoreDisputed`, and `checkInGate` — before both teams are in, a no-show is the check-in sweeper's forfeit to award, not one roster's decision.
- The deciding vote calls `execReportMatchResult(..., forfeit: true, skipRatingUpdate: true)` at `winsNeeded`–0, so **neither team's rating moves and every pending wager is refunded** — betting stays open until a score is reported, so a team losing mid-series can refund its own backers by giving up. `bump_team_record` still fires, so it is a loss on the record.
- The threshold check runs **before** the already-voted answer: a team at the threshold whose report failed would otherwise be stuck, since everyone who could press has already voted.
- A non-deciding vote posts `forfeitVotePost` publicly, pinging only the forfeiting team — a team can't give a match up quietly. The deciding vote has no counterpart: it posts `matchResultPost` and deletes the channel.
- My Team's vote read is **best-effort** — a pre-migration deploy reads null and draws as "nobody has voted". The core refuses rather than acting on a count it couldn't take.

---

## Theme system

Three themes: `crl6mans` (default), `dark`, `light`.

**How it works**: `globals.css` maps every Tailwind color token (`--color-amber-400`) to an indirection var (`var(--c-amber-400)`). Each theme block (`html[data-theme="dark"]` etc.) sets the `--c-*` values, so swapping `data-theme` on `<html>` re-tokens the entire app instantly.

**Persistence**: the `setTheme()` server action writes to both the `theme` cookie (no-flash SSR) and the `players` table (source of truth). The cookie is mirrored on login in the OAuth callback.

**CRL6Mans theme**: sidebar is hardcoded blue `#3736ac` (not via tokens); content-area primary/buttons and `main h1, h2` are orange `#e88a24` via `--c-indigo-*` remapped to the orange ramp; the active nav item is a solid orange pill. Brand colors: orange `#e88a24`, blue `#3736ac`, white `#ffffff`.

**Utilities**: `text-on-accent` (always white, for text on colored bg) and `bg-pure-white` are defined via `@utility` and beat Tailwind's layered utilities.

---

## Tiered account model

Three tiers, added by `scripts/tiered-accounts-migration.sql`:

| Tier | Table | Exists for | Owns |
|---|---|---|---|
| 1 | `accounts` | every Discord login | `status`, `username`, `display_name`, `avatar`, `theme`, `nav_layout`, `crl_coins`, `ban_reason`, `kick_reason`/`kicked_until`, `mfa_enabled`, `session_version`, Patreon fields |
| 2 | `pending_players` | anyone who has registered | tracker URL, MMR, enrollment proof, `sub_willing` (PK `account_id`) |
| 3 | `players` | approved/banned players | roster + draft state: `team_id`, `is_captain`, `draft_entered` (`id` = `account_id`) |

**Account-level state is written to `accounts` and only mirrored onto `players`.** Tier 3 keeps legacy copies of `username`/`display_name`/`status`/MMR because plenty of not-yet-migrated call sites read them straight off `players`, but a write that lands only on the mirror is invisible to every migrated surface — that's the bug class behind stale nicknames, lost theme choices, and test users the admin page couldn't see. When adding a feature, read Tier 1 for who someone *is* and Tier 3 for what team they're on.

`username` and `avatar` are the exception that proves the rule: the OAuth callback refreshes them on Tier 1 at every login, and `/api/cron/discord-sync` (`app/lib/discord-identity-sync.ts`) re-reads them from Discord daily and writes **both** tiers, because nothing else writes the Tier 3 copies at all. That sync never touches `display_name` — that column is a nickname the player sets in Settings, not Discord's `global_name`.

A row-creating flow must create all the tiers it needs: `approvePlayerWithEdits` (Tier 3 on approval) and `createTestAccounts` in `admin/league-actions.ts` are the two worked examples. `players.account_id` references `accounts(id)` with no cascade, so deletes go Tier 3 → Tier 1 (which then cascades Tier 2).

---

## Key database tables (inferred from queries)

| Table | Purpose |
|---|---|
| `accounts` | Tier 1 — one row per Discord login; source of truth for status, display name, theme, coins, moderation state |
| `pending_players` | Tier 2 — registration data (tracker/MMR/enrollment proof), keyed by `account_id` |
| `players` | Tier 3 — roster/draft state for approved players; also carries legacy mirrors of username/display_name/status/MMR |
| `teams` | Draft-formed or pre-formed teams |
| `league_settings` | Single-row global config (draft_open, draft_active, season_active, num_teams) |
| `tournaments` | Tournament records with status, join_mode, format, dates |
| `seasons` | Archive of completed manual seasons (name with year, summary champion/runner-up/standings, format, team_count, dates) — mirrors `tournaments.summary` |
| `tournament_entries` | Player sign-ups for player-mode tournaments |
| `team_signup_members` | Player membership in team-mode sign-up groups |
| `player_edit_requests` | Pending tracker URL change requests awaiting admin approval (MMR columns are vestigial) |
| `matches` | Season/tournament match results |
| `sub_requests` | Substitute player requests |
| `match_forfeit_votes` | One row per (match, player) vote to give a match up; PK is the dedupe, `team_id` is audit-only |
| `series` | Best-of series between teams |
| `staff_roles` | `discord_id` + `role` (`moderator`/`director`/`ceo`) — source of truth for staff permissions |
| `push_subscriptions` | Web push endpoints for browser notifications |
| `player_game_stats` | Per-player, per-game scoreboard stats (goals/assists/saves/shots/score) parsed from submitted series replays |
| `clips` | Media tab clip submissions (YouTube/medal.tv/Streamable); `archived_at` marks past weeks instead of deleting |
| `clip_likes` | One row per (clip, player) like on the Media tab |
| `season_accolades` | Hand-awarded season accolades (MVP/OPOTY/DPOTY/ROTY); one holder per accolade per season. Keyed on `event_id` with no FK, like `player_event_results` — the backfilled seasons have no `seasons` row |
| `event_accolade_prizes` | Per-event prize value for each of the four accolades, keyed on the same `event_id`. Career points are recomputed from these on every read |

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
DEVELOPER_DISCORD_IDS            # Comma-separated snowflakes that resolve as CEO in getStaffRole,
                                 # regardless of staff_roles. Hidden: the Staff panel still shows
                                 # the stored title. Not settable through the site.
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
- **Auth guard pattern**: every protected page calls `decrypt(...)` at the top; redirect to `/login` on null session, redirect to `/dashboard` if the status check fails.
- **No comments unless the why is non-obvious.** Well-named identifiers are the docs.
- **No error handling for impossible cases.** Trust internal guarantees; only validate at system boundaries.
- **"cpd"** is shorthand the user uses for "commit, push, deploy" — do the full sequence when asked for it.
