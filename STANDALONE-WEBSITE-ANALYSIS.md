# Running CRL 6Mans Without Discord

An assessment of what it would take to make the website stand entirely on its own, and
what the league would gain and lose by doing it.

Written 2026-10-13. Every number below was measured against production on that date;
where something is an estimate or unmeasured, it says so.

---

## The one number that frames everything

The website's only way to reach a player on its own is web push.

| | Count |
|---|---|
| Real (non-test) accounts | 57 |
| Real accounts with status `approved` | 35 |
| Approved accounts that are **not** staff or developers | 29 |
| …of those, with a web-push subscription | **1** |

Three of the four people with push subscriptions are staff — one CEO and two directors.
The fourth is a single ordinary player.

**The website, on its own, can notify 1 of 29 players. Discord's channels reach the
rest.** Everything else in this document is secondary to that.

Caveats worth keeping in view:

- Push is granted **per browser**. A desktop grant does not reach that player's phone,
  so even the 1 is not reliably reachable on the device they play on.
- The sample is 29 players, taken during a test event with only 1 real rostered player.
- This is a **plateau, not a ramp**. `app/lib/push.ts` and `app/api/push` landed
  2026-06-16 — four months ago. A one-time in-app prompt asking approved players to turn
  notifications on landed 2026-09-08. Sixty-four commits in the last six months touch
  push or notifications. The feature is mature and promoted, and adoption is still ~3%.

### Why 3% is not survivable

`CHECKIN_WINDOW_MS` is **10 minutes** (`app/dashboard/my-team/check-in-window.ts:8`, and
again at `app/lib/discord-bot.ts:3373`), and the penalty for missing the window is a
**forfeit**. A notification that does not arrive is not an inconvenience — it is a lost
match. At 3% reach, the website alone cannot run a check-in window.

This bites hardest in bracket play. `openCheckInForMatch` honours a `round_schedules`
time when one exists and is still in the future — so a season with a published schedule is
the weaker case, because players know when to be there. But with no schedule, or a
schedule already past, **the window opens the instant the matchup seats** — that is, the
moment the previous round's result lands. The comment at `discord-bot.ts:3571-3576` spells
out the trap directly: a player trusting a displayed time could be forfeited on a window
that had already closed. In that case the notification is the *only* signal a match has
started, which is precisely why reach matters there.

---

## Pros of going standalone

### 1. Latency comes out of the bot-driven flows
Discord REST calls are the dominant cost in anything the bot drives. Measured from a home
connection (so treat these as indicative, not production figures):

- **~30–40 seconds** of Discord-attributable work across the entire 15-match forfeit wave.
- **250–500 ms** added to an individual Discord-touching action.

Worth stating plainly: most of the 3–4 minutes that wave visibly took was waiting for a
sweep trigger and navigating between pages, **not** Discord. And commits `52d8b93` and
`6a56a06` trim the Discord portion further — both are committed but **not yet deployed**,
so the figures above do not include them. The ceiling on this win is real but modest —
tens of seconds on batch operations, a few hundred milliseconds elsewhere.

Page loads barely change. Only `app/dashboard/register/page.tsx` makes a Discord call
while rendering (`isGuildMember`, ~250 ms). `my-team/page.tsx` imports only DB-only
helpers from `discord-bot.ts`.

### 2. Less integration code to maintain

| File | LOC |
|---|---|
| `app/lib/discord-bot.ts` | 6,222 |
| `app/lib/discord-api.ts` | 731 |
| `app/lib/match-embeds.ts` | 549 |
| `app/lib/command-embeds.ts` | 393 |
| `app/lib/draft-embeds.ts` | 139 |
| `app/lib/discord-identity-sync.ts` | 93 |
| `app/lib/clip-embeds.ts` | 56 |
| `app/lib/match-notifications.ts` | 37 |

**Read that total carefully: it is 8,220 lines across files that *touch* Discord, not
8,220 deletable lines.** `discord-bot.ts` alone is 6,222 of them, and it also holds the
draft and season orchestration plus the five shared series cores — all of which a
standalone site still needs. Going standalone would *move* most of that code, not remove
it. The genuinely deletable portion is the REST wrappers and the embed builders, and it
has not been measured.

What does go away is a class of complexity peculiar to Discord: embed-vs-content mention
rules (a mention inside an embed notifies nobody), the 1024-character field limit, role
resolution through `teamPing`, and channel permission overwrites that live in Discord
rather than in the database.

### 3. Discord-side configuration that cannot be automated goes away
Editing per-command channel permissions needs a **Bearer** token with
`applications.commands.permissions.update` from a guild admin — a bot token is rejected.
So the bot can never maintain that list as match channels come and go. The match commands
have to be set to **All Channels** by hand in Server Settings → Integrations, and
narrowing them again silently kills them everywhere. Permanent manual configuration, with
a silent failure mode.

The guild also holds **206 of Discord's 250-role limit**, a ceiling the league will
eventually hit as teams accumulate — though part of that count belongs to the other
program sharing the server, so the headroom problem is not entirely the league's own.

### 4. One surface to design, test and document
Right now every player-facing flow exists twice. The duplication is handled well — five
shared cores in `discord-bot.ts` (`submitSeriesResultCore`, `confirmSeriesResultCore`,
`cancelSeriesSubmissionCore`, `disputeSeriesResultCore`, `castForfeitVoteCore`), with
their prose kept deliberately surface-neutral and pinned by
`scripts/test-series-report.ts` — but it is still two sets of copy, two sets of error
paths, and two places a change has to land.

### 5. No Discord outage or policy risk
Discord rate limits, API deprecations, and terms changes stop being able to break the
league's operations. Note this is dependency **moved**, not removed: a standalone site
leans on an email provider and on the browser vendors' push services instead.

### 6. Full control over presentation
Embeds are constrained: Discord's own colours, field limits, and layout. A web UI has none
of those limits.

---

## Cons of going standalone

### 1. There is no login without Discord
`app/api/auth/` contains exactly three routes: `discord/`, `patreon/`, and
`patreon-admin/`. The Patreon routes are **account linking**, not authentication. There is
no password, magic-link, or email-provider code anywhere in the codebase.

The Discord snowflake is the **only** identifier on an account. Grepping `app/lib/*.ts`,
the registration pages, and `scripts/tiered-accounts-migration.sql` for "email" turns up a
single hit: a comment in `app/lib/patreon.ts:234` about Patreon's own name/email linking.

**There is no email address, phone number, or any other contact field in the schema.**

So going standalone means building password or magic-link auth, email delivery,
address verification, and password reset — *and* migrating 57 existing accounts whose sole
key is a snowflake, with no way to contact their owners except through Discord.

### 2. Admin-panel MFA is currently free, and would stop being
`accounts.mfa_enabled` gates the admin panel, and the OAuth callback is its **only**
writer. Per `CLAUDE.md`, the 30-day `SESSION_MAX_AGE_MS` cap exists precisely because that
callback is also the only thing that re-reads the flag — unbounded session renewal would
let a staff member who disabled Discord 2FA keep admin access forever.

Standalone means building TOTP enrollment, secret storage, recovery codes, and a re-check
cadence, to get back to where the OAuth callback already puts you.

### 3. The website has no messaging surface at all
I walked all of `app/dashboard/` and grepped every `from("…")` call for tables named
message, chat, comment, `dm_`, or thread. There is nothing. `app/dashboard/notifications/`
is a one-way system feed.

What the site does have is **structured** scheduling — `timeProposedPost`,
`timeAcceptedPost` and friends. What it has none of is free text. Teams currently use the
match channel to swap lobby name and password, negotiate a time, and say "give me 5
minutes." None of that has a home on the website.

Replacing it means per-match chat: storage, realtime transport, moderation, mobile
notifications, history, and search.

### 4. Live dispute evidence goes away — but it is less of a loss than it looks
Every bot message into a match channel goes through `app/lib/match-embeds.ts`, so while a
dispute is open the negotiation, the check-ins and the submissions all sit in one
scrollback an admin can read.

**That scrollback is not an archive, though.** `execReportMatchResult` deletes the match
channel as soon as it posts the result — `discord-bot.ts:5335`, on *every* result, not
just forfeits — and nulls `discord_channel_id`. So the evidence exists only until the
match is reported, and is gone permanently afterwards. Add that a match whose channel
failed to open or was deleted has no trail at all.

This con therefore partly inverts: a standalone append-only per-match event log is work to
build, but it would be **more durable than what exists today**, because it would survive
the result being reported.

### 5. Enforcement stops being automatic
`app/lib/moderation.ts` imports `addRole`, `removeRole`, `removeRoleById`,
`timeoutMember`, and `banMember`. Line 102-103 applies the `Kicked` role plus a timeout;
line 196 calls `banMember(discordId)`, which removes the person from the guild outright.
`/resyncmoderation` re-applies all of it if the guild is reconfigured.

A website-only ban blocks login. It does not remove someone from the community space —
and the community space is where griefing actually happens.

To be precise about the size of this loss: the guild would still exist either way, since
it also hosts the private 6mans queue bot, so staff could still ban, kick and time out
**by hand** in Discord. What standalone actually costs is the **automation** — one
moderation action on the site currently applies the site-side and Discord-side
consequences together, and `/resyncmoderation` can re-apply the whole state. Afterwards
that becomes two manual steps in two places, with the attendant drift when someone
forgets the second one.

### 6. The recruiting funnel is the Discord
The guild has **501 members, 196 online**, against 57 real accounts.
`app/dashboard/register/page.tsx:32` calls `isGuildMember` and renders a "Join the Discord
First" page with the invite link if the player is not in the server — you cannot register
without being in the guild.

Be careful how much weight this carries, though. That server also hosts the private 6mans
pickup-queue bot, and it holds another program's bot and roles. **501 → 57 is not a
recruiting yield figure.** The defensible claim is narrower: the league recruits from a
community that already exists, and the website has no independent discovery channel of its
own.

### 7. Zero-infrastructure delivery becomes infrastructure
Discord currently provides, for free: message delivery, mobile push, notification
settings, message history, and search. Replacing that stack means push infrastructure
(exists, 3% adoption), an email provider (does not exist), and either a serious
PWA-adoption drive or a real mobile app.

### 8. The two-surface fallback is lost in one direction
Discord down → My Team still works. That is genuinely valuable.

The reverse does **not** hold, and it would be wrong to claim it: `/report` is handled by
`POST /api/discord/interactions`, which runs on Vercel. If Vercel is down, both surfaces
are down. Both also depend on Supabase. So this is a one-directional fallback, not
redundancy.

---

## Things Discord is often credited with but does not actually provide here

**Anti-smurf / identity verification.** There is no Discord account-age check anywhere in
registration — I grepped for it. The league's actual identity machinery is the college ID
proof plus the platform-account verification system: `app/lib/platform-account-gate.ts`,
replay-evidence verification, and `verified`/`revoked`/`valid_from` validity windows on
`platform_accounts`. Discord contributes one account per Discord login and the
guild-membership precondition. That is friction, not proof of identity — and the
guild-membership gate is registration friction as much as it is a funnel.

**Proven player usage of the slash commands.** The **All Channels** flip in Server
Settings → Integrations is still outstanding, so `/report`, `/dispute`, `/forfeit`,
`/approve`, `/reject`, `/checkin` and `/sub` do not currently appear in match channels at
all. And nothing in the schema records which surface a report came from, so there is no
evidence either way about how much players prefer the bot.

**~100% notification reach.** A role ping appears in the channel for everyone holding the
role, but whether it *notifies* depends on each member's mute and role-mention settings.
This has not been measured. The honest comparison is "the channel reaches everyone in it"
versus "push reaches 1 of 29."

---

## What standalone would cost to build

| Capability | Status today | Work required |
|---|---|---|
| Authentication | Discord OAuth only | Password or magic-link auth, email delivery, verification, reset |
| Contact details | No email/phone column anywhere | Schema change, then collect an address from all 57 existing accounts — reachable only via Discord |
| Account migration | Snowflake is the only key | Migration path with an email-claim flow for every existing account |
| Admin MFA | Free via OAuth callback | TOTP enrollment, secrets, recovery codes, re-check cadence |
| Notification delivery | Push at 3%, no fallback | Email provider, plus a PWA-adoption drive or a mobile app |
| Match coordination | No free text on the site | Per-match chat: storage, realtime, moderation, history, search |
| Dispute evidence | Channel scrollback, destroyed when the result posts | Append-only per-match event log and viewer — more durable than today |
| Moderation enforcement | Site + Discord action in one step | Site-side stays; Discord-side becomes manual, and `/resyncmoderation` is lost |
| Recruiting | Guild-gated registration | A discovery channel the league does not currently have |

Rough order of effort: authentication and the account migration are the hard blockers.
Notification delivery is the one that decides whether the league can actually run — and
it is gated on player behaviour, not on code.

---

## Verdict

The latency case for dropping Discord is real but small: tens of seconds on batch
operations, a few hundred milliseconds on individual actions, and already shrinking. The
maintenance case is stronger, though smaller than the 8,220-line figure suggests, since
most of that code moves rather than disappears — the solid part of it is the permanently
manual Discord-side configuration with a silent failure mode.

Neither outweighs the fact that **the website cannot currently notify its players**, and
that a missed 10-minute check-in costs a team the match. Add that Discord is also the only
login and the only source of admin MFA, and standalone is not a simplification — it is
three substantial systems (auth, contactable identities, notification delivery) to build
before the league can run a single event, plus a coordination surface it has never had.

The two cons worth *discounting* when weighing this up are the ones that sound worst:
moderation enforcement does not vanish, it becomes manual; and the dispute trail is
already destroyed when a result posts, so replacing it would be an improvement.

### The middle path, if the goal is less Discord dependence
In rough order of value for effort:

1. **Raise push adoption deliberately.** It is the single highest-leverage item, and the
   only one that changes the 3%. It caps well below 100% because it needs a per-player,
   per-browser grant, and no target here is forecastable from the data — but any
   substantial improvement changes what the website is capable of doing unaided.
2. **Add an email column and collect addresses**, while Discord still works as the channel
   for asking. This is the prerequisite for every later step, and it is cheap now and
   expensive later.
3. **Keep trimming Discord latency** where it is free, as `52d8b93` and `6a56a06` do —
   starting by deploying those two.
4. **Keep the shared-core pattern.** It is what makes two surfaces affordable, and it is
   also what would make a future reduction in Discord scope straightforward.

Reducing what Discord is load-bearing *for* is achievable and worth doing. Removing it
entirely is a rebuild, and the first thing it would break is the league's ability to tell
players that a match has started.
