# CRL 6Mans — Admin Reference Guide

## Instructions for the AI reading this document

If you are an AI assistant and an admin has handed you this file to ask questions
about how the CRL 6Mans website works, follow these rules:

1. **This document may be out of date or slightly incorrect.** The site continues
   to be developed after this file was written, and nobody guarantees it has been
   kept in sync with every change. Before answering a question, remind the admin
   (briefly, once — not before every message) that you're working from a snapshot
   description that could be stale, and that they should double-check anything
   important (like a rule that affects a ruling or payout) against the actual site
   or the league's human developer/admin lead if it really matters.
2. **This document intentionally contains no implementation details.** There is no
   source code, database schema, file names, function names, or technical
   "inner workings" here — only a surface-level, plain-language description of
   what each part of the site does and how it behaves from a user's point of view.
   If an admin asks something that would require actual code/implementation
   knowledge to answer (e.g. "what does line X of the code do," "why did this
   specific bug happen," "how is this exact number calculated internally"), tell
   them this document doesn't go that deep and that question needs the developer.
3. Otherwise, use the descriptions below to answer admins' questions about what a
   page does, who can access it, and what a given workflow looks like from the
   outside. Keep answers in plain language — the audience is league staff, not
   programmers.

**How this document is organized:** After the two intro sections below (what the
league is, and how logging in/registration works), the guide moves through the
site roughly in the order a player experiences it — draft and season structure,
matches/scheduling/subs, stats/standings/podium, wagers, then a grab-bag of
smaller pages, notifications, and the Discord bot — and finishes with a long,
tab-by-tab walkthrough of the Admin Dashboard itself. If you're looking for one
specific feature, search for its heading rather than reading top to bottom.

---

## What CRL 6Mans is

A competitive Rocket League "pickup" league for college players. Players register
through Discord, get sorted into teams each season (either drafted by team
captains or auto-balanced by the system), and then play a scheduled tournament
season of matches against other teams. Along the way there's a career stats
leaderboard, an end-of-season "podium" celebration, and a for-fun virtual-coin
betting feature ("Wagers") players can use to bet on match outcomes.

## Logging in & becoming a player

- Everyone logs in with their Discord account — there's no separate password.
- The very first time a brand-new user logs in, they see a one-time **Welcome**
  page ("Welcome to CRL 6Mans 👋 — A quick tour to get you set up. You'll only
  see this once.") explaining what the site is for and listing what they can do
  once registered (register, enter the draft, visit My Team, browse
  Teams/Players/Stats, check Season & Podium, turn on notifications). It also
  walks through adding the site to a phone's home screen like an app (Share →
  Add to Home Screen on iPhone/iPad Safari; the ⋮ menu → Install app on
  Android Chrome). A "I got it! Take me to the dashboard" button dismisses it
  for good.
- To actually participate, a user fills out the **Register** form:
  - A Rocket League tracker profile link.
  - Six MMR numbers: All-Time Peak and Season Peak, each for 1v1, 2v2, and
    3v3.
  - A file upload proving current college enrollment (a photo or PDF — a
    transcript, enrollment letter, school ID, or diploma all work). The form
    warns players to blur or cover sensitive details like a student ID
    number, SSN, birthdate, or address before uploading, and rejects files
    over 5MB with a tip to compress the image first.
  - A yes/no toggle for whether they're willing to be called on as a
    substitute for other teams' matches.
  - Before the form actually submits, a "Sensitive Information Notice" popup
    asks the player to confirm they're comfortable with the site storing
    their enrollment proof — the confirm button is disabled for a 3-second
    countdown as a deliberate "don't just click through this" pause.
  - Submitting puts the account into **pending** status, notifies staff of a
    new registration to review, and sends the player a Discord DM confirming
    it's in the queue.
- If a player is a Discord server member but hasn't joined the actual server
  the league runs in, they see a "Join the Discord First" prompt instead of
  the form.
- An admin then **approves** or **rejects** the registration from the
  Approvals tab (see the Admin Dashboard section below). A rejection can come
  with a cooldown before the player is allowed to try registering again
  (immediate retry, a short 5-minute wait, a 1-day wait, or a permanent
  block, depending on why they were rejected). A rejected player who's
  otherwise still active sees "Re-submit Registration" with the rejection
  reason shown; if their rejection also carried a kick, that reason shows too.
  Once approved, they can join the draft pool, get placed on a team, place
  wagers, etc.
- Beyond pending/approved/rejected, an account can also be **kicked** (removed
  from active play, reversible, with a timeout ranging from 1 hour up to 28
  days) or **banned** (removed and blocked from the Discord server; a banned
  player must fully re-register from scratch if ever unbanned).
- After registering, a player can also link one or more actual game-platform
  accounts (Steam, Epic Games, PlayStation, Xbox, Nintendo Switch) from their
  Settings page by uploading a replay and identifying which in-game scoreboard
  row is them. An admin has to verify each claim before it counts toward
  match-identity checks — see Settings, further down, and the Identity
  Discrepancies tool in the Admin Dashboard section.
- A player can also request changes to their MMR numbers or tracker link at
  any time after registering — those edits go through the same kind of admin
  approval before they take effect on the live record (see Settings below).

## Dashboard Home

This is the landing page every player sees after logging in — think of it as
the site's front door, built to answer "what's happening right now and what
do I need to do" without digging into other pages.

- A personalized greeting at the top ("Welcome back, {name}"), using a
  player's display name if they've set one, otherwise their Discord username.
- An announcement banner appears here when staff have something league-wide
  to say, and a separate banner nags a player to update their tracker link
  if it's flagged as stale or broken.
- A static card links out to the external "6 Mans Queue Leaderboard" site —
  a separate community tool, not part of CRL 6Mans itself.
- If a tournament is currently active, a highlighted "Active Tournament"
  card (with a pulsing green dot to signal it's live) shows the tournament's
  name and exactly where it stands right now — things like "Group Stage,
  Round 2," "Swiss, Round 3," "Single Elimination — Semi Finals," "Winners
  Bracket, Round 1," or "Grand Final." If the tournament hasn't actually
  started yet, this card shows the upcoming draft or tournament start time
  instead.
- A "Season" area shows a draft-join card when a season is about to form
  teams but hasn't yet. Once a season is underway it shows a "Season Active"
  badge — unless a tournament is active and already covers the same event
  via the "Active Tournament" card above, in which case this area is hidden
  entirely rather than showing the same event as active twice.
- An "Open Tournaments" area lists anything currently accepting sign-ups —
  either an individual join card (players-mode) or a team sign-up panel
  (teams-mode) — each laid out as a timeline: sign-ups open, sign-ups close,
  then either "Draft starts" or "Auto-balance executes" depending on how
  teams will be formed, and finally the tournament start.
- An "Upcoming Tournaments" area lists anything scheduled for the future
  that hasn't opened sign-ups yet.
- A "Past Events" area lists up to the 8 most recently completed seasons and
  tournaments, as a quick way to jump back to old results without digging
  through the archive.

## Staff roles

There are three tiers of staff, each able to act on everyone below it but not
above it:

- **Moderator** — can act on regular (non-staff) players only.
- **Director** — can act on moderators and regular players, plus has access to
  a much larger set of admin tools (league settings, tournament creation,
  scheduling, wagers administration, identity-discrepancy review, staff
  management, etc.).
- **CEO** — a single, unique seat. Can act on anyone, including other staff,
  and holds a few tools nobody else can touch (transferring the CEO seat
  itself, wiping/disconnecting the Discord bot's configuration, the Discord
  channel-sync debug tool).

Staff ranks are cumulative in terms of what they unlock — a Director also has
everything a Moderator has, and the CEO has all three at once. Adding or
removing a staff member always follows a strict one-rank-down rule: a
Director can only promote/demote Moderators, and the CEO can only
promote/demote Directors. Nobody can remove their own staff role. Separately,
who you're allowed to personally moderate (kick/ban/unban/lift-kick) follows
the same "can't act on someone at or above your own rank" rule — the buttons
for those actions simply don't appear on a person's row if you don't outrank
them, rather than appearing disabled. See "Staff role management, in more
detail" under the Admin Dashboard section for the full CEO-transfer process.

## Seasons & tournaments

A tournament (or season) goes through this lifecycle: **scheduled → active →
completed** (or it can be cancelled). Two things are decided when it's set up:

- **Who joins:** either individual players sign up and get grouped into teams,
  or pre-formed teams sign up as a unit (with their own roster of members who
  each have to accept an invite to join).
- **How teams are formed** (individual sign-up only): either a live **snake
  draft** (team captains take turns picking players in front of everyone, in
  a live draft screen — see below), or **auto-balance** (the system sorts
  players onto teams automatically by skill, aiming for fairness rather than
  captain choice).

A tournament can also be flagged as a **Test Tournament/Season** — a real
dry run of the whole system that gets fully discarded when it finishes (no
permanent archive record, no payout), as opposed to a real event which gets
permanently archived and does pay out. The Season Settings and League
Controls sections of the Admin Dashboard (below) also cover the season-level
version of this and every other setting described here.

### Format presets

When a tournament or season is set up, staff pick one of eight preset
tournament shapes:

1. **Single Elimination** — one knockout bracket; a single loss eliminates a
   team.
2. **Double Elimination** — a Winners Bracket and a Losers Bracket run in
   parallel; a first loss drops a team into the Losers Bracket rather than
   eliminating them, and only a second loss eliminates them. The winner of
   each bracket meets in the Grand Final. If the Losers-side team wins that
   first Grand Final game, a second "bracket reset" game is played to decide
   it for good; if the Winners-side team wins outright, there's no reset
   needed.
3. **Group → Single Elimination** — teams are split into groups and play a
   round-robin first; a fixed number of the top finishers in each group then
   advance directly into a Single Elimination bracket.
4. **Group → Swiss → Single Elimination** — groups first, then group
   qualifiers move into a Swiss stage (rounds paired up by each team's
   current win/loss record rather than a fixed bracket), and the Swiss
   qualifiers then move into a Single Elimination bracket.
5. **Group → Swiss → Hybrid (12-team)** — groups first, then Swiss, feeding a
   12-team "Hybrid" bracket: the 4 group winners go straight into an Upper
   Bracket while 8 Swiss qualifiers enter a Lower Bracket; teams that lose in
   the Upper Bracket's quarterfinal round don't get eliminated — they drop
   down into a later Lower Bracket round instead — and the two sides
   eventually converge at the Semifinals and then the Grand Final.
6. **Group → Swiss → Hybrid (8-team)** — the smaller version of the same
   idea: 4 group winners in the Upper Bracket and 4 Swiss qualifiers in the
   Lower Bracket, with Upper Bracket quarterfinal losers dropping straight
   into the Lower Bracket (skipping an extra middle round the 12-team version
   has).
7. **SE Qualifier → Swiss → SE** — an opening Single Elimination mini-bracket
   decides who advances into a Swiss stage, whose qualifiers then feed a
   second, main Single Elimination bracket.
8. **DE Qualifier → Swiss → SE** — the same idea, but the opening qualifier
   round is a Double Elimination mini-bracket instead of single-elimination.

Group stages, where used, size themselves automatically based on the total
number of teams (roughly: more than 32 teams uses 8 groups, more than 16 uses
4 groups, otherwise 2 groups). In the two Hybrid formats specifically, each
group sends its very top finisher(s) straight into the Upper Bracket and a
next tier of finishers into the Swiss stage instead — not everyone who
advances goes to the same place.

Once a tournament is "active," matches get scheduled and played out through
whichever format was chosen, and standings update as results come in. When
the very last match of the deciding stage is reported and there's nothing
else left scheduled anywhere in the bracket, the site automatically fires a
"Season Complete!" or "Tournament Complete!" notification and, eventually
(see the note at the end of this section), shows the champion on the
Podium page.

### Rank Value (RV)

Every player has a single "Rank Value" number used to keep the draft and team
balancing fair. It's built from a player's peak and current in-game MMR, mostly
weighted toward their 2v2 rank with some credit for 3v3. It's also used as a
minimum-skill eligibility bar in some formats, as the tiebreaker for standings
ties, and as the basis for sub-eligibility checks. Admins don't need to
calculate this by hand — it's shown automatically wherever it matters (draft
order, player lists, team averages, etc.).

### Captains

- A team's captain is automatically whoever has the highest Rank Value on that
  team.
- A team with two or fewer players doesn't count as having a captain (it's not
  considered a full roster).
- Captaincy is locked in for the season — if a player's MMR changes later, the
  captain doesn't automatically change.
- If the captain leaves or is moved off the team, nobody is auto-promoted; the
  team is simply captainless until an admin sets one, or until a new player
  joins bringing the roster back to 3+, at which point the highest-RV player is
  automatically made captain.

### The Live Draft

When a tournament uses a snake draft, captains pick their teams on a live,
shared web page (`/dashboard/draft`) that everyone can watch. This page is a
**spectator view only** — nobody clicks a "pick" button on the website itself.
Picks are actually submitted through a Discord slash command, `/pick <player
name>`, typed by the captain whose turn it is (or by staff on their behalf).
Anyone else who tries is told either "Only captains can pick" or "It's Team
{n}'s turn to pick."

The draft page is laid out in three columns: an "on the clock" card telling
everyone whose turn it is and reminding them to use `/pick` in Discord; a
"Draft Pool" list of every undrafted player sorted best-available-first; a
"Teams" panel showing every team's roster fill (each team drafts up to 3
total players — a pre-assigned captain plus 2 live picks), tagging your own
team as "you" and whoever's currently picking as "on clock"; and a
"Pick Order" queue showing the next several upcoming picks. A permanent
"Snake Draft" badge with a pulsing dot sits at the top — there's no
alternate draft format on this page.

**Snake order:** picks alternate direction every round. Round 1 runs from the
highest-numbered team down to Team 1; round 2 flips and runs Team 1 up to the
highest team; and so on. Each team gets exactly 2 live picks total (on top of
their pre-assigned captain).

When a pick lands, Discord posts a confirmation ("**{Team}** picks
**{Player}**!") and then pings whoever's up next with a fresh **45-second**
countdown, or announces "Snake draft complete! Rosters are locked." if that
was the last pick. The web page itself refreshes automatically every few
seconds to reflect the new pick — there's no special animation, just a
periodic refresh.

If the 45-second clock runs out with no pick submitted, the system
auto-picks the single best-rated player still available on that team's
behalf and Discord announces it ("Team {n} ran out of time! Auto-picking
**{username}**..."). This can't get permanently stuck waiting on an
unresponsive captain — the check for an expired deadline runs constantly in
the background regardless of whether anyone has the page open. The
countdown display itself shifts color as time runs low: neutral for more
than 20 seconds left, amber/warning from 20 down to 11 seconds, and red for
10 seconds or fewer.

### The Season page

Once a season is active, `/dashboard/season` shows whichever tabs are
actually relevant to the format in use — a season never shows a tab for a
stage it doesn't have. In display order: **Standings** (the overall
leaderboard, always shown), **Bracket** (whichever of Single- or
Double-Elimination applies), **Swiss**, **Hybrid**, **SE Qualifier** / **DE
Qualifier** (for those two presets' opening mini-bracket), **Groups**
(appears from the moment the season starts, even before any group match has
been played), and finally a read-only **Format** tab showing how the season
is configured. Teams that got cut at season start for exceeding the format's
max team count never appear in Standings at all.

**Round naming.** Single- and Double-Elimination winners-side rounds are
named backward from the end: Final, Semifinals, Quarterfinals, and "Round of
{N}" for anything earlier. The Double-Elimination losers side mirrors this:
LB Finals, LB Semis, LB Quarters, LB Round {n}. Section headers read plainly
"Winners Bracket," "Losers Bracket," and "Grand Final" (with its standby
bracket-reset game, greyed out and unplayable until it's actually needed).
The two Hybrid brackets use "Upper Bracket," "Lower Bracket R1" (12-team
version only — the 8-team version skips straight past this), "Lower Bracket
R2," "Lower Bracket QF," "Semifinals," and "Grand Final"; a team dropping
from the Upper Bracket shows up in the Lower Bracket only as clickable
"Loser of UB M1"-style placeholder text until that match is actually
decided. Swiss rounds are just "Round 1," "Round 2," etc. — instead of a
fixed bracket tree, teams are grouped into color-coded boxes by their
current live record (undefeated, winning, even, or losing) and paired
against teams with matching records each round, avoiding rematches where
possible; a team gets a "Qualified" or "Eliminated" badge once it crosses
the format's win/loss threshold (3 wins/3 losses in the full 16-team Swiss,
2 wins/2 losses in the smaller 8-team version used by the 8-team Hybrid
format).

**Match states.** A match slot shows one of five states in the
elimination/Swiss views — BYE (an automatic pass), TBD (neither team known
yet), WAITING (one team known), UPCOMING (both teams known, no result yet),
or FINAL (completed, winner highlighted) — collapsed to a simpler
TBD/UPCOMING/FINAL in the Hybrid view. One quirk worth knowing: the Swiss
record boxes always display a "BO5" label regardless of the stage's actual
configured best-of length — it's just a fixed label in that part of the
screen and doesn't reflect the real setting, so don't rely on it to know
how many games a Swiss match is actually being played to.

**Standings tie-breaks — two different rules depending on the tab.** The
overall Standings tab ranks by Wins, then fewest Losses, then alphabetically
by team name — goal differential plays no part here. The Groups tab instead
ranks by Wins, then Goal Differential, then Goals For, and displays those
extra columns directly in the table. In the Groups tab, teams advancing
directly are marked "Advances (direct)"; for the two Hybrid formats only, a
second, lower tier of advancing teams is marked "Advances (Swiss)" instead,
since they go to the Swiss stage rather than straight to the bracket.

**Best-of length** can be set as one flat value that applies to an entire
stage (used for Group and Swiss stages), or scaled up round-by-round for
bracket-shaped stages — a shorter best-of for standard rounds, increasing at
quarterfinals, semifinals, and the final.

### The Season / Tournament tab

There is no separate tournament overview page — `/dashboard/season` is the
one nav tab for whatever's currently happening (separate from the admin's
own tournament management tools, described in the Admin Dashboard section).
It relabels itself "Tournament" instead of "Season" whenever a tournament
(rather than a standalone manual season) is the one currently active,
driven by `league_settings.active_tournament_id`.

### League-wide toggles that shape all of this

A handful of league-wide settings (set from the Season & League tab of the
Admin Dashboard — see below) govern how the draft and season behave day to
day: whether draft sign-ups are currently open at all; whether substitute
requests can currently be submitted league-wide; the default day/time
matches are expected to be played and a separate deadline day for scheduling
them by (the deadline time itself is always fixed at 11:59 PM local time —
only the day is configurable); and a minimum MMR threshold to join the
draft, checked against either the 2v2 or 3v3 rating (a player only needs to
clear one of the two, not both).

### The gap between "Complete!" and the Podium showing it

The automatic completion notification only fires off a match reported in
one of the true terminal stages — a Single-Elimination final, a
Double-Elimination Grand Final, or either Hybrid format's Grand Final — and
only once there are zero other matches anywhere in the system still
scheduled with both teams already assigned. That means it never fires during
the pause between stages (say, right after the group stage ends but before
the bracket stage's matches exist yet), and for Double-Elimination/Hybrid
Grand Finals, a bracket-reset game has to actually be played and reported
too if the Losers-side team forces one.

Importantly, that notification firing does **not** mean the Podium page
updates automatically. The Podium's permanent record only gets created when
an admin separately runs the archiving step afterward (Season Report /
"Export & Reset Season," or a tournament's "Export & Complete" / "Complete,"
both described in the Admin Dashboard section) — that step is what actually
snapshots the champion, rosters, and top performers into a permanent
record and only then clears out the live data for the next event. So there
can be a real gap in time between "everyone got the completion
notification" and "the Podium page actually shows the new champion," and if
that archiving step is skipped, or the event was flagged as a test, the
Podium page will never reflect it at all.

## Matches, scheduling, and substitutes

- Teams have a match schedule visible on the **Schedule** page (see "Other
  pages" below) and their own **My Team** page, which shows only the single
  next match in detail.
- **Proposing/confirming a time.** The two teams in an upcoming match can
  propose and accept a time themselves. Status badges walk each side through
  where things stand: "Confirmed"/"Scheduled" once it's locked in, "Awaiting
  admin" if it still needs sign-off, "Awaiting" if it's the other team's turn
  to respond, or "Action needed" if it's this team's turn. A proposed time
  that falls outside the league's standard scheduling window shows a warning
  before it can be sent, and still requires the opponent to confirm first and
  an admin to approve afterward — a team can send it anyway or pick a
  different time instead.
- **Tournament check-in.** For tournament matches, once both teams are
  otherwise ready, a 10-minute check-in window opens before kickoff. Each
  team checks in independently ("Check in to confirm you're ready to play"),
  with a live countdown and a clear warning that failing to check in within
  the window results in a disqualification for that match; if both sides
  check in, the match is marked "Ready." Once ready, a private-lobby box
  appears telling each team whether it's the "Home" or "Away" side for
  purposes of setting up the actual in-game private match (the home team
  waits, the away team creates the lobby), along with a matching lobby
  name/password shown identically to both sides.
- **Substitute requests.** If a team needs a substitute for an upcoming
  match, they request one — limited to players who've opted in as
  sub-available, and skill-matched against the outgoing player (a
  substitute's Rank Value has to be at or below the outgoing player's,
  with a modest cushion allowed for lower-rated players). The opposing team
  can simply accept or reject the request directly — no admin needed at
  that stage. If rejected, the requesting team can either ask for a
  different substitute or escalate the rejection to staff for a final call;
  either side, or staff, can cancel a pending request at any point. A team
  can also see and respond to sub requests coming from an upcoming opponent
  in a dedicated panel on their own My Team page.
- **Reporting a result and confirming it.** After a series is played, any
  player on one of the two teams (not just the captain — any approved
  player on the roster can do this) uploads the individual game replay
  files (or enough of them to mathematically decide the series) and
  submits the resulting score. The submitting side then sees "awaiting
  opponent confirmation" with a live countdown — if nobody on the other
  team responds in time, the result auto-finalizes on its own (15 minutes
  for a standalone season, 5 minutes for a discrete tournament, matching
  how much slower season play tends to move). Any player on the opposing
  team can either confirm the score (with a short double-check step before
  it locks in) or dispute it, which reopens the upload flow so it can be
  redone — the one rule is a team can't confirm its own submission. As
  soon as the score is confirmed (by a person or by the auto-finalize
  timer), the match is normally finalized automatically — no separate
  admin click is needed. An admin only has to step in by hand from Match
  Ops (see the Admin Dashboard section) if the system flags an identity
  problem with the uploaded replays (e.g. a player's account doesn't match
  who actually played), or in the rare case automatic finalization fails.
  Uploading replays isn't just paperwork — it's also how the site pulls
  individual player stats (goals, assists, saves, shots, etc.) automatically
  into each player's career stats and the Stats leaderboard.

## Stats, standings, and the podium

- The **Stats** page (`/dashboard/stats`) is a sortable career leaderboard
  built entirely from uploaded match replays — click any column header to
  sort by it. Columns: Player, Team, Games Played; a per-game group (MVP
  rating, Goals/Game, Assists/Game, Saves/Game, Score/Game, Shots/Game, Shot
  %); and a totals group (Goals, Assists, Saves, Score, Shots). It defaults
  to sorting by MVP rating, and only aggregates stats for currently-approved
  players. A short footer note gives the general shape of the MVP formula
  (built from goals, assists, saves, and shots per game, plus a small score
  bonus) without spelling out the exact math.
- The **Season** page (described in detail above) shows current standings,
  the bracket or Swiss pairings, and a read-only view of the season's
  configured format.
- The **Podium** page (`/dashboard/podium`) is a celebration screen that
  shows whichever season or tournament most recently finished and has a
  recorded champion — champion team name and logo, a full roster with an
  MVP callout, and four "Accolades" categories highlighting the event's top
  scorer, top assists, top saves, and MVP-rating leader. If nothing has a
  recorded champion yet, it just sends visitors back to the dashboard home
  (and the nav link itself is hidden in that case). See the note above,
  under Seasons & Tournaments, about the timing gap between a season/
  tournament actually finishing and the Podium page reflecting it.

## Wagers (the betting feature)

Players can spend an in-app virtual currency, shown in the top bar as
"Westside Wages" (🪙), to bet on upcoming match outcomes — who wins the
series (moneyline), or the total number of games played (over/under lines)
— and can combine multiple selections into a parlay.

**Layout.** On a wide screen the page is three panes side by side: a match
list on the left, the selected match's betting detail in the center, and a
bet slip on the right. On narrower screens only one pane shows at a time,
switched with a top segmented control (Matches / Market / Slip), with a
small badge showing how many legs are currently in the slip. If there's no
active season or tournament to bet on, the whole page collapses down to
just a balance banner and the coin leaderboard.

**Placing a straight bet.** Clicking a side of any market (moneyline or an
over/under line) adds it to the bet slip rather than placing it immediately
— clicking the same side again removes it, and only one side per market can
be selected at once. In the slip, each selection gets its own coin-amount
input (defaulting to 100, minimum 10) and a live payout preview; a "Place N
Bets" button submits everything in the slip at once. A player can have at
most 10 pending straight bets at a time, and can't stake more than their
current balance.

**Parlays.** Switching the slip to "Parlay" mode changes what clicking odds
does — selections build a single combined bet (2 to 5 legs) with one shared
stake amount instead of separate individual bets, shown with combined odds
and a payout multiplier (e.g. "3-leg parlay · 4.32×"). Pool-mode matches
can't be added to a parlay at all, since a pool bet has no fixed price to
lock in — only fixed-odds matches are parlay-eligible. A player can have at
most 3 pending parlays at a time.

**Fixed Odds vs. Pool Mode.** Every match uses one of two betting modes,
chosen per match (see the league-wide Betting Mode default in the Admin
Dashboard's Wagers tab). Fixed-odds matches show a standard odds format with
a known payout locked in the instant a bet is placed. Pool-mode matches
instead show a live percentage and a running coin total for each side,
based purely on how much has actually been staked on that side so far
(starting at an even 50/50 split before any money comes in) — the payout
for a pool bet isn't set until the match closes, so it's shown as "payout
set at close" everywhere in the interface until it resolves.

**The algorithm prediction pill.** Separately from the live odds, every
match's detail view shows a distinctly-styled "🤖 Algorithm Prediction"
pill giving the underlying model's estimated win probability for each team.
This number is deliberately kept visually distinct from the odds/percentage
buttons below it, because the two can genuinely differ — fixed-odds prices
build in a small house edge, and pool-mode percentages move with real
money — so the pill always answers "what does the model think," while the
buttons answer "what would I actually be paid." The prediction itself comes
from each team's track record (similar in spirit to a chess rating: teams
that have been winning more than expected build up a stronger rating, and
that gap sets the model's estimate). Admins never set these numbers by
hand.

**Balance, My Bets, and history.** The coin balance is always visible in
the top bar. A "My Bets" panel shows pending totals (amount at stake,
maximum possible payout) and lists every straight bet and parlay with a
status badge (pending / won / lost / push-void), the bet description, the
odds, and the payout (or "payout set at close" for unresolved pool bets).
Clicking any bet jumps back to that match's detail view.

**Standings and rosters on the match view.** Each team shown in a match's
detail header also displays its current standings rank (from the same
win-loss-then-rating tiebreak described under the Season page above) and
the actual lineup rostered for that specific match — accounting for any
approved substitute — with a "(sub)" tag on anyone standing in.

There are two betting formats, summarized again for clarity:

- **Fixed odds** — the payout multiplier is set at the moment you place your
  bet and doesn't change afterward.
- **Pool mode** — more like a shared betting pool; the odds shift live based
  on how much has actually been wagered on each side so far.

Directors can set the league-wide default betting mode, view every player's
coin balance, manually add or remove coins (for one player or in bulk), reset
balances, and see a log of manual coin adjustments. Coins have no real-world
value — they exist only inside the app. See the Admin Dashboard's Wagers tab
below for the full staff-side toolset.

## My Team

For a player who's on a team, **My Team** is by far the richest page on the
whole site — it's the one-stop hub for everything about that specific team's
season. A player with no team is simply redirected back to the dashboard
home instead of seeing an empty version of this page.

- **Team hero header.** Across the top: the team's logo (or an
  auto-generated numbered gradient if no logo's been set), the team name, a
  win–loss record badge, a win-rate percentage, the team's average Rank
  Value, and a "Form" indicator showing the last 5 results as a row of
  colored win/loss squares at a glance. A team that actually won the
  tournament's final gets a "CHAMPIONS" badge here. All of this is hidden
  when there's no active season, since none of it means anything yet.
- **Roster card.** Every rostered player, in order, each showing their
  avatar, name, and Rank Value, with the captain marked by a yellow
  "CAPTAIN" badge. Each name links out to that player's tracker profile. An
  empty roster just reads "No players on this team yet."
- **Recent Results card.** A one-at-a-time carousel (left/right arrows,
  which disable themselves at either end) stepping through the team's
  completed matches — each card shows a win/loss badge, who the opponent
  was, what stage of the season it was, the final score (colored to match
  the win/loss outcome), and a position counter like "2 / 5." Before the
  season has started, or if nothing's been played yet, it just says so
  ("Season hasn't started yet." / "No results yet.").
- **Match Schedule card.** Shows only the team's single next match, and
  only once there actually is a next opponent ready to be scheduled against
  (it stays hidden if that opponent still has an earlier match of their own
  to finish first).
  - The normal case is a **propose-a-time flow**: the opponent's logo and
    name, the round label, and a status badge — "Confirmed"/"Scheduled"
    (green, locked in), "Awaiting admin" (purple, needs staff sign-off),
    "Awaiting" (amber, waiting on the other team), or "Action needed"
    (indigo, this team needs to do something next). A short note explains
    any admin-set scheduling constraints, e.g. "Scheduled window: any time
    on {date} (your local time)" or "Admin set this match for
    {date/time}." Depending on where things stand, the available actions
    are "+ Propose Time," "Accept" (which becomes "Confirm (sends to
    admin)" if the match requires admin approval), "Reject," "Change
    Time"/"Request a different time," or "Remove"/"Cancel request." Times
    are chosen with a picker that won't let you select anything less than
    a minute from now. Proposing a time outside the admin-set window pops
    up a warning — "This time needs admin approval. Your opponent will be
    asked to confirm first, then an admin reviews it." — with the choice
    to send it anyway or pick a different time.
  - Once both teams are checked in for a tournament match, a **private
    lobby box** appears, telling each side whether it's "Home" or "Away"
    for setting up the actual in-game private match — the home team waits
    for the away team to create the lobby — and showing the same lobby
    name and password to both sides so they land in the same match.
  - Before that, a **tournament check-in flow** runs: a status badge shows
    "Ready" once both sides are checked in, "Checked in" if only this team
    has, or "Check in" once the window has opened. The window itself is a
    fixed 10 minutes. Before it opens: "Check-in opens at {time}. Both
    teams must check in within 10 minutes." Once it's open: "Check in to
    confirm you're ready to play," with a live countdown, a clear warning
    that missing the 10-minute window results in a disqualification for
    that match, and a "Check In" button. If the window closes without both
    sides checking in, the page just shows "Check-in window closed.
    Resolving result…" while the system settles it automatically.
- **Sub Request Panel.** Hidden entirely for team-signup-format tournaments,
  where substitutes aren't allowed at all, and shows "Substitute requests
  are currently disabled by staff." if staff have turned subs off
  league-wide. Otherwise, a "+ Request Sub" link opens a form: a "Player
  Being Replaced" dropdown (name and Rank Value shown), a "Substitute"
  dropdown limited to eligible sub-available players (a lower-rated
  outgoing player allows a modest Rank Value cushion above them for the
  substitute; otherwise the sub must be at or below the outgoing player's
  Rank Value — if nobody qualifies, it says "No players with substitute
  availability within the RV limit."), and a free-text reason. Once
  submitted, the request shows a status badge — "Awaiting opponent,"
  "Approved," "Rejected," or "Reported to staff" (escalated) — plus the
  player-out-to-sub-in pairing, the match it applies to, the stated reason,
  and any admin note. A rejected request offers "Report to admin" or
  "Request a different sub"; anything not yet finalized can be cancelled.
- **Opposing Sub Request Panel.** Renders nothing at all if there's no
  incoming request. When an upcoming opponent has requested a substitute,
  this panel shows their team name, the player-out-to-sub-in pairing, Rank
  Value info, and their stated reason, with "Accept" and "Reject" buttons —
  each opens a quick double-check step before the decision is finalized.
- **Score Confirmation / Series Replay panel.** This panel's contents change
  depending on exactly where a match stands:
  - No match scheduled yet: "No match scheduled yet — check back once your
    bracket is set."
  - Opponent not yet determined: "Waiting for opponent to be determined."
  - Opponent still finishing an earlier match: "Waiting on {opponent} —
    {opponent} still has an earlier match to play before they face you.
    You'll be able to upload replays here once they've finished it."
  - Once it's your team's turn to report: both teams' columns (logo, name,
    average Rank Value, roster) frame a running series score, with one row
    per game labeled "Game {N}." Each game slot walks through waiting (drag
    a replay file in, or click to browse for one), analyzing (a spinner),
    done (shows which team won that game — the same replay file can't be
    uploaded twice across different game slots), or error (with a retry
    option). Once the series is mathematically decided, a "Submit Series
    Result" button appears. If a replay won't upload or a player in it
    isn't recognized, the help text points to contacting staff directly.
  - After submitting: any player on the submitting team sees "Result
    submitted — awaiting opponent confirmation," while any player on the
    opposing team sees the claimed score with "Confirm if the score is
    correct, or dispute to start over" and "Confirm Result" / "Dispute"
    buttons (submitting and confirming aren't limited to captains — any
    approved player on the roster can act, though a team can't confirm its
    own submission). Both sides see a live countdown — if the opponent
    doesn't respond in time, the result auto-finalizes on its own (15
    minutes for a standalone season, 5 minutes for a discrete tournament).
    The submitting side also gets a "Retract submission" link while it's
    still pending. Confirming opens a short double-check step (showing the
    win/loss outcome and the score) before it locks in; disputing reopens
    the upload flow so it can be redone from scratch.
  - Confirming the score (whether by a player clicking "Confirm Result" or
    by the auto-finalize countdown running out) normally finalizes the
    match immediately — there's no separate admin approval step in the
    ordinary case. An admin only needs to step in by hand from Match Ops in
    the Admin Dashboard if the system flags an identity problem with the
    uploaded replays, or in the rare case automatic finalization fails.
- **Team Settings editor.** A "Team Name" field (up to 30 characters) and a
  "Team Logo" upload (PNG, JPG, or SVG) with a draggable crop preview —
  horizontal and vertical position sliders let whoever's editing fine-tune
  exactly how the image is framed before saving. Before the season starts,
  any team member can make these edits; once the season goes active, the
  team is locked by default and the editor collapses down to a plain
  "Locked" note for everyone except an admin, who can unlock it again if
  truly needed.
- **Next Match card.** A compact look-ahead at what's coming: "Season
  hasn't started yet" if there's no active season, "Your team won the
  tournament!" if the team is the champion, "Eliminated from the bracket"
  or "No match scheduled yet" if there's genuinely nothing next, or —
  normally — a colored stage badge (Winners/Losers/Grand Final/Swiss/
  Qualifier/a generic Bracket label, each in its own color), a short match
  label, the round name (e.g. "Semi Finals"), and the opponent's logo and
  name (or "TBD"/"Waiting for opponent" if that's not settled yet).
- **Group Stage Schedule.** Shown only when the season is active and the
  current format actually includes a group stage. A group-number badge
  labels which group the team is in, and one row per round shows the
  opponent's name alongside either the completed score (colored by
  win/loss) or just "vs" for a round that hasn't been played yet.

## Other pages

- **About** (`/dashboard/about`) — a short static page: "CRL 6Mans is a
  competitive Rocket League pickup queue for college players. Registered
  players are drafted into teams each season and compete in scrimmages to
  build skills and rank up."
- **Rules** (`/dashboard/rules`) — the full official rulebook (titled "CRL
  West 6mans Summer League" and labeled with its season year). Participating
  implies agreeing to it; it links out to a master document as the ultimate
  source of truth if there's ever a conflict, and shows a "Last Modified"
  date. It breaks down into several sections:
  - **Important Dates** — when sign-ups open and close, draft day, the
    deadline for teams to personalize themselves (name/logo), when the
    first week of play begins, when the last week ends, and championship
    weekend.
  - **Tournament Organizers** — the staff names/handles running that
    season.
  - **League Format** — the default server region (a fallback region is
    allowed if every player plus an admin agree to it), the gamemode
    (3v3), the in-season best-of length, a playoffs format that's decided
    later based on how many teams enter, a rule that any standard map is
    allowed except a few restricted specifically for streamed matches, a
    one-match-per-week cadence (some teams may occasionally play twice in
    a week), a regular season spanning several weeks followed by a play-in
    and playoffs, a default match time, a note that teams may reschedule
    by mutual agreement, and a requirement to report results within 1 hour
    of a series finishing.
  - **Eligibility** — a player must attend, or have attended, a school
    west of the Mississippi River (it's about where the school is, not
    where the player personally lives), with transcripts, an enrollment
    letter, a school ID, or a diploma all accepted as proof. There's also
    a minimum Rank Value required to be eligible at all, using the same
    Rank Value described elsewhere in this guide.
  - **Draft — a known inconsistency worth knowing about.** This section of
    the written rules describes an "Auction Draft": captains are ranked by
    Rank Value and given a starting budget of draft credits, then take
    turns nominating players snake-style under a timer with a maximum
    starting bid, followed by a timed bidding round (with a "slow mode"
    near the end and ties going to whoever bid first), an admin closing
    each round and deducting the winning bid from that team's budget, and
    so on until everyone's drafted and rosters lock with no trades. **That
    is not how the live site actually runs a draft.** The real system only
    ever uses a live **snake draft** (see above) or **auto-balance**, with
    no credits, bidding, or nomination step involved anywhere in the
    product. If asked, the honest answer is that this part of the written
    rules is out of date relative to how the live site actually works —
    the live site is what actually happens, not the written page.
  - **Spirit of the Game** — a zero-tolerance sportsmanship policy;
    inactivity is defined as missing most of a team's scheduled matches
    (after several games have already been played) without an excuse;
    and a zero-tolerance cheating policy covering exploiting, hacking,
    ringers, cheating devices, intentionally disconnecting, misusing
    admin controls, collusion, and smurfing. Violations are reviewed by
    the admin team and their decisions are final — there's no appeal
    process.
  - **Substitutions** — a maximum of one substitute per series (using
    more results in a forfeit); both the opposing team and staff must be
    notified beforehand; subs can only come from players who've marked
    themselves sub-available; a sub's skill must be at or below the
    player they're replacing; the sub's tracker profile gets sent to the
    opposing team to verify before it's finalized; the opposing team can
    ask staff to review a sub they suspect gives a competitive advantage;
    a sub can't be swapped in mid-game, only between games in a series
    (and staff must be told); and playoff substitutions are restricted to
    genuine emergencies or conflicts communicated ahead of time — no
    pulling a sub from another active playoff team, and no last-minute
    subs.
  - **Timeouts** — a Technical Timeout (one per series, capped at one
    minute, meant for disconnects or lag) and, in longer series only, a
    Tactical Timeout (one per team, capped at two minutes, usable only
    between games, and it doesn't carry over if a team never uses it).
  - **Match Management** — each match gets its own dedicated weekly
    channel; teams are solely responsible for arranging their own
    schedule, with no excuses accepted for confusion about a time; a
    tournament organizer must be told once a time is locked in; not
    showing up to a confirmed time can result in a forfeit; rescheduling
    is only allowed within the same match week, never pushed into a later
    week; and the winning team must report the result by tagging a
    tournament organizer, stating the score in the required format, and
    uploading every replay file from the series — reports that don't
    follow that format simply won't be recorded.
  - A footer note reiterates that all of the above applies to the current
    league season specifically and is subject to change season to season.
- **Teams** (`/dashboard/teams`) — browse every team's logo (or an
  auto-generated numbered gradient if none is set), name, and average Rank
  Value, with a small lock icon once that team's roster is locked for the
  season. A "MY TEAM" badge marks whichever card belongs to the viewer. Each
  team's roster lists every player's avatar, name, and Rank Value, with the
  captain marked by a yellow "C" badge and each name linking out to that
  player's tracker profile; an empty roster just reads "No players yet." A
  search box matches whole team names or partial player names, and shows
  `No teams match "{query}".` when nothing does. When a tournament is
  active, only teams whose players entered that specific tournament are
  shown; otherwise any team with at least one assigned player is browsable
  at any time. Admins get a different, editing-capable view of this same
  page for adjusting team membership directly (not covered here — see the
  developer for that tooling's details).
- **Players** (`/dashboard/players`) — a searchable directory of everyone
  who has entered a draft pool, ranked by Rank Value (highest first), with
  columns for their team (or "Free Agent," shown in italics), Rank Value,
  and — on wider screens — their All-Time Peak 2v2 and All-Time Peak 3v3
  numbers. Each row's name links to that player's tracker profile, and a
  "Stats" button opens a detailed card: avatar, name, team, Rank Value plus
  an "RV Rank #X / Y" standing among the whole pool, the full four-number
  MMR breakdown (All Time Peak and Season Peak, for both 2v2 and 3v3), and
  — once game data exists for that player — a "Performance — This Event"
  block with Goals/Game, Assists/Game, Saves/Game, Shots/Game, Shooting %,
  and MVP Rating. The empty state, before anyone's entered a pool yet, is
  "No players have entered the draft pool yet."
- **Schedule** (`/dashboard/schedule`) — all upcoming matches and their
  confirmed play times, in two tabs. The **Matches** tab groups confirmed
  matches by day ("Today," "Tomorrow," or a weekday and date), with each
  match card showing both team names, a round label (like "SE · R2" or
  "Group 1 · R1"), the time, and a status badge — "Confirmed" (green, a
  time exists and is locked in), "Pending" (amber, a time exists but isn't
  confirmed yet), or "TBD" (grey, no time set at all). Below the by-day
  matches are separate sections for anything still "Proposed (awaiting
  confirmation)" and anything fully "Unscheduled," with an overall "No
  upcoming matches" message if the whole page is empty. The **Calendar**
  tab shows a month grid (Sunday through Saturday) with colored bars
  marking round scheduling windows that span multiple days, or single-day
  markers for matches pinned to one specific date. Clicking a day opens a
  popup with any all-day window badges plus an hour-by-hour timeline (12 AM
  to 11 PM) showing exactly when fixed-time matches fall, with a footer
  noting the viewer's own local timezone. Before any round schedules exist
  yet, it reads "No round schedules set yet. Admins can configure them in
  the Admin panel."
- **Scrims** (`/dashboard/scrims`) — currently just a placeholder page with
  a header and nothing else; it's not a working feature yet, so don't
  describe it to players as something they can actually use.
- **Settings** (`/dashboard/settings`) — a player's own account preferences
  and profile-edit hub. Unapproved players see a reduced version (appearance
  and navigation-layout preferences only); approved players additionally
  see:
  - **Appearance** — a light/dark/league theme toggle, applied instantly.
  - **Navigation layout** (desktop only) — sidebar vs. top-and-bottom tab
    layout.
  - **Notifications** — a browser push-permission control plus four
    independent toggle categories (Tournament updates, Draft, Season,
    Announcements), all on by default.
  - **Display Name** — an optional nickname (up to 30 characters) shown
    instead of the player's Discord username everywhere on the site.
  - **Platform Accounts** — claiming a Steam/Epic/PlayStation/Xbox/Switch
    account by uploading a replay, picking which scoreboard row is theirs,
    and providing a tracker link; each claim shows its own status (no
    claim, awaiting verification, verified, rejected with a reason, or
    revoked with a reason) and can be withdrawn while still pending. An
    admin has to verify a claim before it counts toward match-identity
    checks — see the Approvals tab and Identity Discrepancies tool in the
    Admin Dashboard section.
  - **Profile Change Request** — resubmitting the tracker link and/or any
    of the six MMR numbers for admin approval; any changed field is
    visually flagged against its current live value, and a pending or
    rejected request shows its own status banner (with a "Cancel request"
    or "Dismiss" option). Substitute-availability, by contrast, applies
    instantly with no approval needed.
- **Game** (`/dashboard/game`) — a small, unrelated Flappy-Bird-style
  minigame ("a little something for the waiting room") with its own
  leaderboard, mostly just for fun. Click or press Space to flap; difficulty
  ramps up as the score climbs. Only a player's personal best score is ever
  saved, and it's shown alongside a leaderboard of everyone else's best
  scores. Staff can remove individual leaderboard entries from the Wagers
  tab of the Admin Dashboard (see below).

## Notifications

Players can opt into browser push notifications, grouped into four
categories they can each individually turn on or off from Settings:
**Tournament updates** (sign-ups opening/closing), **Draft** (draft
starting, teams finalized), **Season** (season starting/ending), and
**Announcements** (league-wide posts from staff). The fuller list of
specific events a player might actually see notified include: sign-ups
opening or closing (both at the tournament level and, separately, at the
season level), the draft starting, a player not being selected in the
draft, the draft completing and rosters locking, the season starting, a
match becoming ready to play, a match's check-in window opening, a
forfeit/no-show handing a team an automatic win, a submitted result
auto-finalizing after the opponent doesn't respond in time, a proposed
match time needing the opponent's (and sometimes an admin's) approval, a
new result awaiting the opponent's confirmation, and finally the "Season
Complete!" / "Tournament Complete!" announcement described earlier (see the
note on the timing gap before the Podium page actually updates).

Admins have their own separate set of admin-only notifications
(configurable individually per admin from the Admin Dashboard's Overview
tab) for things like new registrations needing review, sub requests, and
schedule approvals — turning one off only affects that individual admin,
not the rest of staff. There's also a single league-wide "mute everything"
push toggle in League Controls; worth knowing that a small number of
notifications are fired by the recurring background scheduler rather than
by someone actively using the site, and those may not fully respect that
mute switch the same way an in-session notification does.

## The Discord bot

Staff can also manage parts of the league directly from Discord using slash
commands, and the bot automatically posts updates back into the server on
its own (pick confirmations during a draft, match-channel setup, etc.).

**Available to everyone:**
- `/site` — replies with the league website link.
- `/pick <player>` — the only way a captain actually submits a live-draft
  pick (see "The Live Draft" above).

**Staff commands** live under `/admin`, and which subcommands a given staff
member can actually run depends on their rank:
- **Moderator** — sync/diagnose team Discord roles, and manually
  assign/remove a Discord role from a user.
- **Director**, in addition to everything a Moderator can do — set which
  channel the draft posts to, which channel is linked as the rulebook,
  which channel announcements post to, where new per-match channels get
  created, which Discord role represents each staff tier below CEO, which
  role is auto-granted on approval, and a "checklist" command that reports
  what's still missing to fully connect the Discord server to the website.
- **CEO**, in addition to everything above — set which role represents the
  Director and CEO tiers, disconnect the bot's saved server configuration,
  a heavily-confirmation-gated "wipe" command for clearing match/wager/
  season data while keeping team slots intact, and a tool for re-applying
  bans/timeouts/roles after moving the bot to a different Discord server.

All `/admin` commands are hidden from regular members in Discord's own
command list, though the actual rank check happens on the site's side
regardless of what Discord shows. A couple of the bot's own help-text
replies (like the `/admin checklist` output) are known to reference slightly
outdated command names — if a staff member reports that a suggested command
doesn't seem to exist as described, that's a known rough edge in the bot's
own guidance text rather than something wrong with their setup; double-check
with the developer rather than troubleshooting it further yourself.

## The Admin Dashboard

This is the main control panel for staff. Moderators can see most of it;
some sections are restricted to Directors and the CEO, noted below wherever
that applies. There are six tabs, always in this order:

**Overview · Players & Staff · Match Ops · Approvals · Season & League ·
Wagers**

On a phone or narrow tablet the tab strip disappears and every section from
all six tabs is simply stacked one after another on a single scrolling page,
in that same order.

A tab can show a small number badge next to its name when something on it
needs attention:

- **Players & Staff** badges with the count of unresolved identity
  discrepancies (see below).
- **Match Ops** badges with the combined count of matches waiting on a score
  report, pending sub requests, and pending schedule-time approvals.
- **Approvals** badges with the combined count of pending registrations,
  pending platform-account claims, and pending profile-edit requests.
- **Season & League** badges with the number of not-yet-scheduled rounds —
  this one only shows up for Directors and the CEO, and only while a season
  is actively running.
- Overview and Wagers never show a badge.

The dashboard remembers which tab, and which collapsible section inside that
tab, you last had open, and reopens to the same spot next time you visit —
you don't have to re-expand everything every time you log in.

If the league's core settings are somehow missing from the system entirely,
an orange banner reading "League settings row is missing" appears above the
tabs with a single button to initialize them. This should never come up in
normal operation.

### Overview tab

This tab is the landing view. Everything on it is a collapsible section,
closed by default until you click to open it.

- **Insights** — a trend chart covering the last year, broken into three
  separate colored lines: Visits, Registrations, and Draft Joins. A legend
  below the chart lets you click a color to hide or show just that one line,
  so you can look at a single trend in isolation. The scale on the side of
  the chart adjusts automatically depending on how big the numbers are that
  week.
- **Notifications** — five separate on/off switches for push notifications
  that go to *your own device only*: Match Reporting, Sub Requests, Pending
  Registrations, Profile Change Requests, and Schedule Approvals. All five
  are on by default. Turning one off has no effect on any other admin's
  notifications.
- **Team Slots** (Directors and the CEO only) — manages the pool of team
  "slots" that exist before a season starts: essentially reserving a team
  name and linking it to the matching Discord role ahead of time. A status
  banner at the top tells you at a glance whether every slot has its Discord
  role linked, or how many are still missing one. Each slot can be edited to
  change its linked role, and only the most recently added slot can be
  deleted (so slot numbers always stay in order — you can't delete one from
  the middle). A text box at the bottom lets you add the next slot. There's
  also a "Download All Team Logos" link above this section for grabbing a
  backup of every team's logo image at once, and a "Delete All" button that
  wipes every team slot in one shot — this also unassigns every player and
  deletes every match, since everything else is built on top of these slots,
  so it asks you to confirm before doing anything.

### Players & Staff tab

- **Players** — the roster of everyone who has ever been fully approved into
  the league, whether or not they're currently on a team. A search box
  filters by name, and filter chips (All / Active / Kicked / Banned) narrow
  the list, each showing a live count. Each row shows the player's avatar,
  name (linked out to their tracker profile), their computed Rank Value, and
  a status badge if they're currently kicked or banned. An "Edit" toggle
  opens their username, tracker link, and their six MMR numbers (peak and
  current, for 1v1/2v2/3v3) for editing, plus any linked game-platform
  accounts they have, each of which can be individually edited, deleted, or
  revoked. Depending on your staff rank relative to theirs, you may also see:
  - **Kick** — opens an optional reason field and a timeout-length dropdown
    (1 hour up to 28 days, defaulting to 7 days), then a confirm button.
  - **Ban** — opens a reason field (strongly recommended) and a confirm
    button.
  - Already-kicked players show **Lift Kick** instead of Kick/Ban; already-
    banned players show **Unban** instead.
  - Banned players are grouped together in their own section underneath
    everyone else.
- **Unregistered/Pending Accounts** — works exactly like the Players list
  above (same search, same kick/ban tools) but covers accounts that signed
  up and were never approved onto the roster. Its filter chips are
  Unregistered / Pending / Rejected / Kicked / Banned.
- **Identity Discrepancies** (Directors and the CEO) — this is where
  mismatches between who actually appears in an uploaded replay file and who
  was supposed to be playing get reviewed and resolved. Two league-wide
  toggles live at the top:
  - **Identity Enforcement** — when on, any match with an unresolved
    discrepancy is blocked from being marked complete; when off,
    discrepancies are still logged for the record but nothing is blocked.
  - **Verified Account Join Gate** — when on, a player must have an active,
    verified game-platform account before they can join a draft, tournament,
    or team; when off, anyone otherwise approved can join regardless of
    verification status.

  Each flagged case is shown as two side-by-side panels — what the replay
  file actually shows (name, team color, platform, account, where the
  mismatch was caught) versus what was expected (who was supposed to be
  playing, who they conflict with, and the stated reason for the mismatch).
  Below that, a Resolution dropdown offers a small set of standard outcomes
  (things like: it was a documented pre-match registration error, the
  account was approved before kickoff, the pre-match lineup was recorded
  wrong, it was a legitimate approved substitute, the match should be
  rejected/forfeited, or the case should be escalated as suspected
  unauthorized play), plus a required written reason and a save button. If
  the flag is tied to one specific game, a "Reverify" button re-runs the
  automatic check against the corrected information without needing a fresh
  upload. **Important:** saving a resolution here only records the decision
  for the record — it does not by itself forfeit or certify a match. Actually
  deciding a match's outcome (forfeiting a team) happens from Match Ops.
- **Staff Management** — three lists: the CEO (a single person), Directors,
  and Moderators, each entry showing the person's name and Discord account.
  A "Remove" option only appears on someone's row if you outrank them — a
  Director can remove Moderators, the CEO can remove Directors, and nobody
  can remove their own staff role this way. Below the lists, an "Add Staff
  Member" form lets you pick a rank (limited to ranks below your own),
  provide the person's Discord account and name, and add them. CEO-only,
  there's a separate "Transfer CEO Role" tool for handing the CEO seat to
  someone else — it requires typing an exact confirmation phrase before the
  button unlocks, and warns clearly that transferring away your own CEO
  status cannot be undone from within the site.

### Match Ops tab

- **Match Reporting** — every open match, grouped by round/stage into
  collapsible sections. Each match shows the round, match number, best-of
  format, and both team names, each with its own "Forfeit" button (requires
  a second confirm click). Score boxes appear for both sides, unless the two
  teams already agreed on a score through the normal player-facing flow (that
  result is typically already final by the time it reaches this page — the
  system only needs admin action here if it couldn't finalize on its own), in
  which case a green "captains agreed" badge shows the locked-in score
  instead. A "Replays" toggle reveals a drag-and-drop uploader for each
  individual game in the series — dropping in a replay file analyzes it,
  reports which side won that game, and unlocks the next game's upload slot.
  If a replay contains player names that don't match either team's expected
  roster, it flags those names as unmatched and asks you to manually map
  each one to the correct registered player before re-analyzing. The
  "Submit" button for the whole series is disabled until both scores are
  filled in and aren't tied; submitting without every replay uploaded shows
  a warning that per-player stats won't be calculated for that series unless
  you confirm you want to submit anyway.
- **Sub Requests** — shows the requesting team, who asked, the player being
  subbed out with their Rank Value, one or more proposed replacements with
  their own Rank Values (flagged if a candidate is over the outgoing
  player's skill limit), the team's stated reason, a note field for you, and
  Approve/Decline buttons.
- **Schedule Approvals** — match times the two team captains agreed on
  outside the league's normal scheduling window. Each entry shows the
  requested time, a short note on why it falls outside the normal window,
  and Approve/Reject buttons.

### Approvals tab

- **Registrations & Platform Claims** — two related item types shown
  side by side.
  - Registration cards show every field from a pending sign-up (username,
    tracker link, all six MMR numbers), links to the player's college-
    enrollment proof and tracker profile, a note field, a "Rejection
    Cooldown" dropdown (no cooldown / 5 minutes / 1 day / forever — how long
    a rejected applicant is blocked from re-registering), and Approve/Reject
    buttons.
  - Platform Account Claim cards show which game platform is being claimed
    (Steam, Epic, PlayStation, Xbox, or Switch), the claimed display name and
    account ID, a flag banner if the system suspects something's off, a link
    to a tracker profile and/or uploaded replay evidence, editable account-ID
    and display-name fields, a note field, the same cooldown dropdown, and
    Verify/Reject buttons. Rejecting with a cooldown set also removes the
    player from active play for that duration.
- **Profile Change Requests** — a current-value-versus-requested-value
  comparison for the tracker link and all six MMR fields, changed values
  highlighted, plus a note field and Approve/Reject buttons. Approving
  copies the new values onto the player's record and, if they're currently
  on a team, recalculates that team's overall rating.
- **Verified Platform Accounts** — a history of everyone whose game-platform
  account has already been verified: verification method, verification
  date, and the date the account became valid from. Two actions are
  available: "Correct" (edit the account ID, display name, or valid-from
  date — requires a written reason, meant for fixing a pre-match
  registration mistake or backdating a date so a replay being re-checked can
  still certify) and "Revoke" (also requires a reason; un-verifies the
  account).

### Season & League tab

Most of this tab is Director/CEO-only; where a section is open to
Moderators too, it's noted.

- **Announcements** — posts a message to the site's home-page banner, to a
  Discord channel, or both, chosen with a three-way toggle. The text box
  supports basic formatting (bold, italic, underline, strikethrough, code,
  spoiler, @mentions, #channel links) with a hint row showing the syntax.
  Anything sent to Discord automatically starts with an @everyone. A "Check
  Mentions" button previews any names or channels you typed and color-codes
  each one — green means it will actually notify, amber means it's an
  uncertain match worth double-checking, grey means it will just post as
  plain text with no real mention. "Post Announcement" publishes it; "Clear
  Live Announcement" removes whatever is currently showing on the home page.
- **Scheduling** (only shown while a season is actively running) — every
  stage of the season laid out as collapsible round-by-round groups. Each
  round can be set to one of four scheduling styles:
  - **Range** — a window of several days starting from a chosen date.
  - **Weekly** — always a fixed one-week window.
  - **Custom** — every match in that round is scheduled individually rather
    than sharing one window.
  - **Specific** — one exact date and time for the entire round.

  A "Follow previous round" toggle chains a round's start to when the round
  before it ends, so dates don't have to be recalculated by hand as things
  shift. Rounds that use a shared window can be expanded to pin an exact
  time for any individual match inside it, and once a match's Discord
  channel actually exists, that match's row locks since it's already in
  progress. A one-time "Start Round" button appears on the very first round
  of a standalone season — the round exists but stays paused until you press
  it, giving you a last look before it goes live.
- **Tournaments** — both a creation form and a history list.
  - The creation form covers: a name; a "Test Tournament" toggle (test
    events are fully discarded when completed — no archive, no season
    currency payout — versus a real event, which is archived and paid out);
    whether players sign up individually or as pre-formed teams; for
    individual sign-ups, how teams get formed (**snake draft**, where
    captains take turns picking, or **auto-balance**, where the system sorts
    people onto teams automatically by skill); minimum and optional maximum
    team counts; optional minimum MMR requirements to be eligible; and a
    **Format** dropdown of eight tournament shapes: Single Elimination,
    Double Elimination, Group → Single Elimination, Group → Swiss → Single
    Elimination, Group → Swiss → Hybrid (12 teams), Group → Swiss → Hybrid
    (8 teams), SE Qualifier → Swiss → SE, and DE Qualifier → Swiss → SE.
  - Choosing a format with a group stage reveals Group Stage Settings:
    seeding (balanced by skill, or random), how many teams advance out of
    the groups, and how many rounds the group stage runs.
  - A Best-Of setting appears per stage that needs one — either one flat
    best-of value for every match in that stage, or separate values for
    Standard / Quarterfinal / Semifinal / Final matches.
  - A Stage Schedule block lists every stage in order with an estimated
    real-world duration for each (based on the best-of settings and team
    count) and a date/time field for when it should begin; picking a start
    time that's too early relative to the stage before it shows a warning.
  - Sign-up open/close times and, for player-based events, a draft-start
    time round out the form. "Schedule tournament" saves it.
  - Existing tournaments below show status badges (scheduled / active /
    completed / cancelled), a "test" badge if applicable, and whether
    sign-ups are open. Scheduled tournaments get Open/Close Sign-ups,
    Activate (disabled while another tournament is already active), Edit,
    and Cancel buttons. The active tournament gets "Export & Complete"
    (downloads a full report, then marks it complete and resets the team
    pool — irreversible) and a plain "Complete" button. Completed
    tournaments with saved standings get "Export PDF" (downloads the report,
    then permanently trims the stored record down to just the champion,
    runner-up, and dates) and, if a full archive was saved, "Download
    Archive."
  - A collapsible "All Events" list holds every past tournament and season
    together, each with a Show/Hide toggle (controls whether it appears on
    the public Home page and Podium) and a Delete option that requires
    confirming the action is permanent. This is also where the link into the
    View Archive tool (below) lives.
- **Season Settings** — the format editor for the season currently
  configured, as opposed to a one-off tournament: the same preset picker,
  the same Group Stage Settings, the same per-stage Best-Of blocks, plus a
  live "Stage Flow" diagram showing how many teams go into and come out of
  each stage — with an adjustable preview count so you can see how the
  bracket would look at different team counts, and a note that byes are
  applied automatically whenever the team count isn't an exact power of two.
  Saving is blocked with a warning if the real team pool is smaller than the
  chosen format's minimum, and a separate warning explains that the format
  will still run but the lowest-rated excess teams will be cut if the pool
  is larger than the maximum. While a season is actively in progress, this
  whole section is replaced with a "Locked — season in progress" message so
  the format can't change mid-run.
- **Draft Pool** — everyone currently signed up and waiting to be placed on
  a team, with a search box. Each entry shows avatar, name, Rank Value, and
  when they joined the pool; "Remove" pulls them back out. If any
  tournaments are running their own separate sign-ups at the same time,
  those show up as their own labeled groups below the main pool — team
  sign-up groups show each team's full roster with member invite/accept
  status and a "Remove Team" option for withdrawing an entire team's
  sign-up.
- **League Controls** — the block of serious, mostly irreversible commands:
  - Toggles for whether draft sign-ups are open, and whether new sub
    requests can be submitted league-wide.
  - A Match Schedule block setting the Default Play Day, Default Play Time,
    and Match Deadline Day (deadline is always 11:59pm local time on the
    chosen day).
  - A Minimum MMR to Join block setting separate floor values for two
    playlists (a player qualifies by meeting either one).
  - **Start Draft**, **Auto Draft**, **End Draft**, and **Start Season** —
    four serious commands, each requiring you to type an exact confirmation
    phrase before the button unlocks, plus a final countdown warning
    showing exactly what will happen before it actually fires. Start Draft
    resets all teams and begins a live draft where captains pick; Auto Draft
    skips the live draft and balances teams automatically by Rank Value; End
    Draft permanently locks every roster; Start Season opens the season for
    match play.
  - **Force Tracker Update** — flags every player and sub in the active
    event to re-verify their tracker account; until they do, they're
    blocked from submitting replays for their next match.
  - A **Test Season** toggle (locked while a season is active) — same
    discard-on-completion behavior as the tournament-level test toggle.
  - While a season is active, **Export & Reset Season** downloads a full
    report, then deletes matches, unassigns every player, and strips team
    roles — irreversible, with its own confirmation.
  - A league-wide **Push Notifications** mute toggle (distinct from the
    personal notification list on Overview).
  - A **Testing** section (off by default, with its own warning before you
    can even enable it) for adding test users individually or 32 at once,
    generating fake test teams, removing all test users, stripping Discord
    team roles from everyone, and a **Reset Season** button that deletes all
    teams and resets the season immediately — the raw destructive version,
    as opposed to Export & Reset Season, which saves a report first.
  - A **Live State** readout showing the system's own internal
    understanding of where the draft currently stands, useful for
    diagnosing a stuck draft.
  - An **Emergency** section with a single "Force Clear Draft State" button
    meant only for when the draft is visibly stuck and the normal controls
    aren't responding.
  - CEO-only, a **Debug Channels** tool scans every match's Discord channel,
    reports which ones are in sync, need to be created, or are orphaned
    (no matching match), and offers to fix all three at once.

### Wagers tab

- The core section is a searchable balance table listing every approved
  player's name and current point balance. An "Adjust" toggle per row
  reveals an amount (positive or negative) and a required reason, followed
  by an Apply button — available to any Moderator.
- Directors and the CEO additionally see a league-wide **Betting Mode**
  toggle (Pool Mode vs. Fixed Odds) that sets the default for any newly
  opened match; matches that already have bets keep whatever mode they
  opened under.
- Also Director/CEO-only: **Bulk Adjust** (apply the same point change to
  every approved player at once, with a two-click confirm) and **Reset
  Everyone to 1000** (overwrite every balance to exactly 1000 rather than
  adjusting it, same two-click confirm). No player's balance can ever go
  below zero.
- A **Recent Adjustments** log shows the last several entries — amount,
  whether it was a single change or part of a bulk/reset batch, the reason
  given, who did it, and when.
- A separate **Game Leaderboard** section manages the Flappy-Bird-style
  minigame's leaderboard: search, and a "Remove" option per entry to delete
  a score from the board entirely.

### View Archive

A Director/CEO-only tool, reached from the "View a downloaded archive
file" link inside the Tournaments section above. You pick a previously
downloaded season/tournament export file from your computer; the site
checks that it's a valid, uncorrupted archive before loading it. Once
loaded, a header shows the event's name, team count, and exactly when it
was originally exported. Below that, a row of tabs appears based on what
the archive actually contains — Standings always first, then whichever
bracket-shaped view matches the event's format (Bracket, Swiss, Hybrid, SE
Qualifier, DE Qualifier, and/or Groups), then Rosters and Stats always
last. Rosters shows every team with its logo, record, and average Rank
Value, and every player with a captain badge and individual Rank Value.
Stats shows aggregated per-player statistics pulled from every recorded
game in the archive.

An archive is captured at the exact moment a tournament or season is
completed, before the live match/team data is wiped for the next event —
including team logos saved directly into the file rather than linked, so
an archive still displays correctly long after the live tournament data
(and even the original logo images) have been deleted from the system,
making it a genuinely permanent, self-contained historical record.

### Staff role management, in more detail

There are three ranks, stacked in order: Moderator, Director, and CEO (a
single, unique seat). The ranks are cumulative in terms of what they unlock
in Discord — a Director also holds everything a Moderator holds, and the
CEO holds all three at once. Adding or removing a staff member always
follows a strict one-rank-down rule: a Director can only add or remove
Moderators; the CEO can only add or remove Directors. Nobody can remove
their own staff role through this tool.

Separate from who can *add or remove* staff, there's a rule governing who
you're allowed to personally moderate (kick, ban, unban, lift-kick)
elsewhere in the dashboard: **you can't act on someone at or above your own
rank.** Concretely — the CEO can act on anyone. A Director can act on
anyone except another Director or the CEO. A Moderator can only act on
people who hold no staff role at all. This is enforced by simply not
showing you the Kick/Ban/Unban/Lift-Kick buttons on a person's row at all
if you don't have standing over them — what you see is exactly what you're
allowed to do.

Transferring the CEO seat is a separate, heavily guarded action available
only to the sitting CEO. It requires entering the new CEO's account details
and typing an exact confirmation phrase before the button unlocks. The
system promotes the new person to CEO first, and only afterward demotes the
outgoing CEO down to Director — so if anything goes wrong partway through,
the league is never left without a CEO at all. The interface warns clearly
that this cannot be undone from within the site once it completes.
