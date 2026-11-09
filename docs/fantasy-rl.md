# Fantasy Rocket League — Design Spec

Status: **design agreed, not yet built.** Living document — edit as decisions change.
Origin: Kotala's proposal + the design discussion of 2026-11-05/06. Anything in
[Open questions](#open-questions) is still undecided.

---

## 1. Overview

Each manager builds a fantasy team out of real league players. Every fantasy week those
players' real series stats earn the manager points, and two managers face off. The regular
season is a round robin; the top 4 enter a two-week playoff.

- Fantasy runs alongside a **3v3 season** only — tiers come from the real snake draft.
- The season must have **stats tracking enabled** (scoring comes from replay stats).
- **No fantasy during a test season.**
- **No prizes** — no CRL coins or career points.

---

## 2. Leagues

| Rule | Decision |
|---|---|
| Who can manage | Any registered (approved) player |
| Creating | Each person can **own one** league per season. A creator who left has passed theirs on and can create another; someone who inherited one can't |
| Joining | A person can be in **multiple** leagues |
| Size | **4–6 managers.** If the real season has **21 or fewer teams**, max is **4** |
| Visibility | Commissioner sets **public** (anyone can join) or **private** (invite only). Both are listed in the directory |
| Invites | **Private leagues only** — a public league has nothing to invite to. The commissioner invites by name from the league page; the invitee gets a feed notification. A private league's Join button carries small "Invite Only" text above it and is **grey** unless the viewer is invited, **green** when they are |
| Viewing | Anyone logged in can view any league, **public or private** (read-only) — including unregistered and pending players. Guests can't |
| Undersized | A league with **fewer than 4 managers** when the admin starts the drafts is **disbanded** |
| End of season | League is archived read-only (§15) |

### Commissioner (league creator) powers
- Rename the league
- Set public / private
- Remove managers **before the draft** (a removed manager can't rejoin unless re-invited, which means switching the league to private first)
- Invite players by name, and cancel pending invites, **before the draft** (private leagues only)

An owner who leaves never disbands the league: it **passes to the earliest-joined manager
left**, before or after the draft (§11). Only a league left with nobody in it is deleted.
The leave confirmation tells the owner who it passes to.

Commissioners cannot force-close weeks or override results — that is staff only.

### Leaving a league
- **Before the draft:** allowed.
- **During the draft:** not allowed, and the owner can't remove anyone either. A kick or ban
  still applies (§11).
- **After the draft:** allowed. See [Manager departure](#11-manager-departure).

---

## 3. Player pool and tiers

### Who is draftable
Every player on a real team when the drafts start, **except the managers of that league.**
Subs are never draftable: a sub is filler for whichever team needs one, and only becomes
draftable by being swapped onto a team before the drafts start. A manager can never draft, claim, add or receive in a
trade themselves or any other manager in their own league — those players are never shown as
options.

### Tiers
| Tier | Drafted players | Rostered without a draft round (auto-balanced, or added to a team) |
|---|---|---|
| Tier 1 — Captain | Real team captains | Top ⅓ by rating |
| Tier 2 — 1st round | Real 1st-round picks | Middle ⅓ by rating |
| Tier 3 — 2nd round | Real 2nd-round picks | Bottom ⅓ by rating |

- Rating = RV (`app/lib/rating.ts`), compared against all players in the season.
- A player's tier is **fixed for the season** once assigned, no matter what — including a
  move to another real team.
- **Prerequisite:** the site doesn't currently record which round a player was drafted in.
  Needs a column written at pick time.

---

## 4. Rosters

- **8 players: exactly 2 Tier 1, 3 Tier 2, 3 Tier 3.**
- Tier limits apply **all season**, not just in the draft. Every roster move is like-for-like:
  - A Tier 1 can only be swapped for a Tier 1, Tier 2 for Tier 2, Tier 3 for Tier 3.
  - This applies to free-agent adds, waiver claims and trades.

### Lineup
Each manager has **one lineup** — there are no per-week lineups. 6 starters + 2 bench:

| Slot | Eligible |
|---|---|
| Cap | Tier 1 |
| 1st ×2 | Tier 2 |
| 2nd ×2 | Tier 3 |
| Flex | Any tier |
| Bench ×2 | The remaining two |

- UI: the position button shows **Cap / 1st / 2nd / Flex**; pictures are Discord avatars.
- The lineup can be changed at any time, except for players who are locked (see
  [Locking and slot scores](#6-fantasy-weeks-locking-and-slot-scores)).
- Changes open once the league's draft has finished: a draft pick lands in a slot chosen
  before the pick is locked in, so a move mid-draft could take that slot from under it.
- A move is a **swap**: tap a position, then tap where that player goes. Both players have to
  fit where they land, and neither may be locked. Rules are in `app/lib/fantasy-lineup.ts`; the
  swap is `fantasy_swap_slots` (`scripts/fantasy-lineup-migration.sql`).

---

## 5. Scoring

### Per-player series points
```
points = 20 × FP(own-team games, N) + bonus × (games played ÷ N)    [bonus only if his team won]

FP(games, N)  = Σ (Sc + 250·G + 85·A + 60·Sv + 10·Sh) ÷ (660 × N)
bonus         = wins needed − games his team lost
```
- `N` = **number of games in the series**, not games the player played. A player who played
  1 game of a 5-game series has his 1 game's stats divided by 5.
- Dividing by `N` makes `FP` a per-game average, so a 3-game and 5-game series compare fairly.
- `FP` replaced the Stats page's MVP formula (`app/lib/stats-math.ts`) here; the Stats page
  still uses MVP. The 660 puts the league's median player at `FP ≈ 1`, so a median player's
  stat points are ≈ 20 per series. How the weights were chosen, and how points are predicted
  ahead of a series, is in [fantasy-projections.md](fantasy-projections.md).
- **Win bonus** — best-of-5: 3-0 = +3, 3-1 = +2, 3-2 = +1. Best-of-3: +2 / +1. Best-of-7:
  +4 / +3 / +2 / +1. Prorated by games played.
- **Subbing for another team earns nothing** — only games played for his own team count.

**Example:** Player A plays game 1 of a 3-2 win, a sub plays games 2–5.
A scores `20 × FP(game 1 stats, N=5) + 1 × (1 ÷ 5)`.

### Weekly matchup
A manager's weekly total = the sum of his 6 starting slots' scores for that week (see
[slot scores](#slot-scores-first-score-counts)). Higher total wins.

### Special cases
| Case | Score | Fills the slot for that week? |
|---|---|---|
| Normal series | Formula above | **Yes** |
| Forfeited series | 0 | **No** — another player can still fill it |
| Real team on bye | 0, shown with a **BYE** tag | **No** |
| Didn't play (sub covered all games) | 0 | **Yes** — their team played |
| Player kicked / banned / left the league | 0, obvious **ineligible** indicator | **No** — replace with an unlocked same-tier player |
| Slot never filled by the time the week closes | 0 | — |

### Late changes
Points are **computed on read** from current stats, the way career points are — never
stored. A resolved unmatched replay player, a dispute or an admin stat edit updates fantasy
points automatically.

---

## 6. Fantasy weeks, locking and slot scores

The guiding rule: **whatever lineup a manager has when a game is played is what he gets.**
This replaces per-week lineups, which broke down because real rounds are often played out of
order.

### Weeks
- **Fantasy week N = real group-stage Round N.** A series always counts toward the round it
  belongs to, regardless of when it's played.
- Several fantasy weeks can be open at once.
- **A week closes when every series in that round is final** (reported, forfeited or
  cancelled). Staff can force-close a week whose series is never played.

### Locking
- **A player is locked from his match's scheduled start time until the series is reported**,
  then unlocked again. This is true whichever week the match belongs to — a player playing
  his Week 2 series early is locked during it even while Week 1 is still running.
- A locked player can't be moved between slots, benched, dropped or traded.
- A match with **no scheduled time** has no lock window.

### Slot scores: first score counts
- **Each starting slot holds one score per week.** The first player to play his series for
  that week **while sitting in that slot** sets it, and it is final.
- "While sitting in that slot" means the slot he is in when his series is reported. For a
  scheduled match that's the slot he was locked into at the start; for an unscheduled match
  it's wherever he is at report time.
- A score is assigned only at the moment a series is played. Moving a player afterwards
  carries nothing with him — his already-played series can't fill a different slot.
- A player who plays while **on the bench**, or in a slot already filled for that week,
  earns the manager nothing for that series.
- Dropping or trading a player never removes a score his slot has already banked.

**Example:** Gio (Tier 1) is in the Cap slot and plays his **Week 2** series early, scoring 12.
The Cap slot's Week 2 score is now 12, final. Week 1 is still open and Gio's Week 1 series
hasn't been played. Once Gio is unlocked, his manager can swap in another captain who hasn't
played Week 1 yet; that captain's Week 1 series fills Cap for Week 1. His later Week 2 series
does nothing for Cap, because Cap's Week 2 is already filled.

**Why not let a later score override an earlier one?** Series in a normal week are played on
different days. With an override, a manager whose starter scored badly on Monday could bench
him for a player who plays Thursday and take the better score — a free re-roll every week.

### Known gap
An unscheduled match has no lock window, so a manager watching it live could bench a player
before the report to keep the slot open. Teams scheduling their matches closes this.

---

## 7. Season structure

- **Regular season = group-stage rounds − 2.** The last two rounds are the fantasy playoffs.
  The real knockout bracket isn't used.
  - Example: 8 group-stage rounds → weeks 1–6 round robin, week 7 semifinals, week 8 final.
- The round robin **repeats** when there are more weeks than opponents.
- **Odd number of managers** → one manager has a bye each week (no matchup, no W/L).

### Standings
- Shown as **W-L**. Ties are possible but so rare with decimal scores that the T is only
  shown if a manager actually has one.
- Tiebreaker: **total points scored**.

### Playoffs
- Top 4: **1 v 4, 2 v 3** in the semifinals, winners meet in the final.
- A tied playoff matchup → **higher seed advances**.
- **Eliminated managers are frozen:** no adds, drops, waiver claims or trades (trades are
  disabled for everyone, §10).

| | Regular season | Playoffs, still alive | Eliminated |
|---|---|---|---|
| Set lineups | ✅ | ✅ | — |
| Waivers / free agents | ✅ | ✅ | ❌ |
| Trades | ✅ | ✅ | ❌ |

The freeze stops an eliminated manager from feeding his players to a manager still in the
playoffs (by trade or by dropping them onto waivers).

---

## 8. Draft

- **Admin starts every league's draft at once**, manually, after the real draft and before
  Round 1. Leagues with fewer than 4 managers are disbanded at that moment.
- **Order: season draft → fantasy draft → season starts.** The admin can't start the real
  season while any fantasy draft is in progress, so no Round 1 series can be played before
  every fantasy draft has finished.
- **Snake draft, order randomized** when the draft starts.
- **1:30 per pick**, except the draft's opening pick, which gets **5 minutes** so every
  manager has time to arrive.
- **Autopick** when the clock runs out: the manager's queue first, otherwise the best
  available by **tier, then rating**, respecting the tier limits.
- Live updates: each open page **polls every 10 seconds**, pausing while the tab is hidden and
  checking immediately when it returns. Same pattern as the season draft's
  `/api/draft/pulse` (`app/dashboard/draft/draft-live.tsx`).
- Cost: worst case ~17k small requests per league draft (6 tabs × 8 hours). Plan is to be on
  Vercel Pro for draft week.

---

## 9. Waivers and free agency

### Player status (unrostered players only)
```
Free agent (instant add)
   │  his series is reported, or a manager drops him
   ▼
On waivers (24h)  ──claimed──▶  that manager's roster
   │  no claims
   ▼
Free agent (instant add)
```
- A player goes on waivers when **his series is reported** (playing again restarts the 24h),
  when he's **dropped**, or when his manager **leaves the league**.
- A **forfeit does not** put a player on waivers.
- **Claims resolve in one fixed daily run at 4:00 AM Pacific**, for every player whose 24h has
  passed. Pinned to `America/Los_Angeles` like the clip-of-the-week crowning, so it stays at
  4 AM through daylight saving changes (11:00 UTC in PDT, 12:00 UTC in PST). The UI shows the
  time in each viewer's own timezone.
- **Free agents** can be added instantly, first come, first served.
- Every add, claim or pickup must **drop a same-tier player** (rosters are always 8).
- **No cap** on adds per week.
- The manager who dropped a player can claim him back through a normal claim.

### Waiver priority (rolling)
- Starts as the **reverse of the draft order**.
- Each manager **ranks their pending claims**, most wanted first.
- **Claims go in rounds.** In each round, every manager from the top of the order down gets
  their highest-ranked claim that still works. Nobody wins a second player until everyone has
  had a shot at a first. Rounds repeat until no claims are left.
- The order **doesn't move during a run**. Afterwards, managers who won nothing move up in
  their current order, and the winners go behind them **reversed**: whoever started highest ends
  up last. If all four managers in a league win, the order comes out exactly reversed. Winning
  two players in one run still moves a manager only once.

---

## 10. Trades

**A director's switch, off by default.** Every manager shares one Discord, so a lopsided trade
is far more likely to be two friends teaming up than one manager outsmarting another, and
waivers and free agency already cover fixing a roster. A director turns trades on or off for
every league at once from the top of the Players tab (`league_settings.fantasy_trades_enabled`,
read by `fantasyTradesEnabled()`). While they're off, proposing and accepting are refused
server-side, and the Players tab's Trades view, the Trade button and the Trades notification
setting are hidden. Turning them off cancels every pending trade, so turning them back on
later doesn't revive offers made against rosters that have since changed. The rules below
apply while trades are on.

- **Any size**, as long as each side gives up the same tiers it receives (keeps both rosters
  at 2/3/3).
- One manager proposes; the other **accepts or rejects**.
- **Either manager can cancel** a pending trade — the proposer or the receiver.
- **Every player in the trade must be unlocked** (not mid-match) when it's accepted.
- If a player in a pending trade **locks**, the trade can't be accepted until his series is
  reported and he unlocks. It stays pending until then.
- Traded players arrive in their new manager's lineup carrying nothing — scores their old slots
  banked stay with the old manager.
- A trade doesn't name slots. At acceptance each incoming player takes the slot of an outgoing
  player of the same tier, pairing them in lineup order (Cap, 1st, 2nd, Flex, Bench).
- If a player in a pending trade has since left either roster (dropped, claimed, or traded
  elsewhere), accepting **calls the trade off** instead.
- Accepting a trade cancels every other pending trade that includes one of its players.
- Every change to a trade notifies the other side (§12).
- **No trade deadline.** A pending trade is cancelled automatically if either manager is
  eliminated, since eliminated managers are frozen.

---

## 11. Manager departure

A kick or ban from the site counts the same as leaving. It applies to every league the player
manages in, and it withdraws every invite and team offer they hold.

**Before the draft** the manager just drops out. If they were the owner, the league passes to
the earliest-joined manager left. A league left with nobody in it is deleted.

**After the draft** (or during it, for a kick or ban), the team becomes an **orphan**:
- It keeps its roster, seat, schedule, record and place in the waiver order. It **keeps scoring
  with its current lineup** and stays in the playoff race. There is no automatic champion and
  the playoffs don't shrink.
- Its pending waiver claims and trades are cancelled. The departed manager can't act for it
  any more, and gets no more notices about it.
- During the draft, its picks are made automatically straight away rather than waiting out the
  clock.
- The owner leaving is no different, except that **ownership passes on** to the earliest-joined
  manager whose team isn't orphaned, so there is still someone to look after orphans. Only if
  every other team is orphaned does the departed owner stay on record, unable to act.

**Every departure is announced** under the League changes toggle (§12). Each manager still
running a team is told who left or was removed (the owner who did the removing isn't). If
ownership passed, the notice says who the new owner is, and the new owner gets their own
version saying so. A manager the owner removed is told too. A kick or ban isn't, since the
moderation is its own notice. Written by `tellManagers` in `app/lib/fantasy-departure-server.ts`.

Before the draft, leaving runs through `fantasy_leave_pre_draft`
(`scripts/fantasy-leave-pre-draft-migration.sql`). It locks the league while it is still
`pre_draft`, the same way joining does, so a leave can't land after the draft start has seated
the draft order.

**The owner looks after an orphan** until someone takes it over.
- They can set its lineup from the Roster tab. It can't make waiver claims or trades.
- Once the draft is finished, they can **hand it over**: offer the team to any approved player
  who isn't already in the league and isn't on one of its rosters. The offer arrives as an
  invite. Accepting it makes that player the team's manager, with everything it had. The first
  player to accept takes the team, and any other offers for it are withdrawn.
- The owner can also remove a manager after the draft. That orphans the team the same way.

---

## 12. Notifications

Fantasy has its **own section** in Settings → Notifications, with six toggles. Each one
covers both the push and the feed entry, and all six default to on.

| Toggle | Category | Sent when |
|---|---|---|
| Fantasy draft | `fantasy_draft` | The draft starts (each manager learns their seat, and the first picker also sees their clock). They're on the clock. They were autopicked. Their league was disbanded at the start for having too few managers. |
| Waiver claims | `fantasy_waivers` | One summary per manager per daily run (about 4 AM Pacific), listing each claim as won, lost to a manager higher in the order, or failed with its reason. |
| Trades | `fantasy_trades` | A trade is proposed, accepted, rejected, withdrawn or cancelled. It is also sent when a trade is called off by a freeze, or by a roster change (a player left a roster, or was traded first in another deal). |
| Lineup alerts | `fantasy_lineup` | A starter won't score in the current week, either because their team has a bye in that round or because they aren't on a team. Only sent while the week is open, for managers who have an opponent that week. |
| Results and playoffs | `fantasy_results` | A week closes: each manager gets their result. Semifinal winners and losers, the champion and runner-up, and everyone else in the league hear about the final. Seeding is sent once the regular season closes: who made the playoffs and whom they face, and who is out. |
| League changes | `fantasy_league` | A manager in their league left, was removed, or was kicked or banned. It names the new owner if ownership passed, and the new owner gets their own notice. The owner removed them. (§11) |

How it works:
- Invites and team offers sit outside the toggles. They go to the feed only, through
  `recordNotification`.
- Event notices (draft, trades, waivers, league changes) are sent where the event happens, through
  `notifyManagers` in `app/lib/fantasy-notify.ts`. Sending runs in `after()`, so it never
  slows down the action.
- Each on-the-clock notice carries the tag `fantasy-clock-{league}`, so a newer one replaces
  the last on the device.
- Results, seeding and lineup alerts have no single moment when they happen, so they are
  **derived on every `clip-reset` tick** by `runFantasyNotices`
  (`app/lib/fantasy-notices-server.ts`).
- Those derived notices are sent once each:
  - `fantasy_notices` (`league_id`, `key`) is the sent log. A key is claimed with
    insert-on-conflict-do-nothing, and only the rows this tick inserted are sent.
  - The first sweep of a league writes a `baseline` row and marks every notice that is
    already due as sent, without sending it, so a deploy mid-season doesn't flood anyone.
  - Scores are only read when a key is new.
- The wording is in `app/lib/fantasy-notices.ts`, a pure leaf with tests in
  `npm run test:fantasy-notices`.
- A test run's rollback deletes the run's `fantasy_notices` rows along with its leagues.

---

## 13. UI pages

Modelled on fantasy football so it's familiar:
- **My Roster** — the one lineup with slot buttons (Cap / 1st / 2nd / Flex / Bench), lock
  icons while a player is mid-match, BYE and ineligible tags, Discord avatars. Each slot shows
  which open weeks it has already filled, so a manager can see where a swap still earns
  points. No projections or next-game stats.
- **Matchup** — the two lineups side by side with points per player (like Kotala's mockup).
- **Players / Waiver wire** — free agents and waiver players, with tier, status
  ("Free agent — Add" / "Waivers — clears in 14h — Claim"). A **Trending** strip at the top
  shows two players per tier, from the whole pool, rostered or not: the biggest scores in their
  last group-stage series for their own team. **Raw points, not a multiple of projection** — 30
  on a 25 projection trends over 25 on a 10, since a multiple puts an ordinary series on a tiny
  projection at the top. A tie goes to whoever beat their projection by more. The projection
  shown beside it is the one that stood before that week was played, rebuilt the same way as the
  Matchup tab's (`trendingByTier` in `fantasy-pool.ts`, `lastSeries` in `getPoolView`). Trades
  live here too,
  so there's no Trades tab. A toggle splits the page into **Available** (unrostered
  players only) and **Trades**, which has the manager's pending trades, plus those resolved in
  the last week, above a table of other managers' players, each with a Trade button. The toggle
  carries a count of incoming offers. A resolved trade can be dismissed, which hides it for that
  manager only. A visitor who isn't a manager sees the whole pool with no toggle.
- **Standings** — W-L, total points, waiver priority.
- **Draft room** — live board, queue, pick timer.
- **League directory** — every league to join or view; create a league.

### Navigation
- One **Fantasy** tab, in the Community nav group.
- `/dashboard/fantasy` is the hub: My leagues, Invites, Create a league, All leagues. A
  manager in **exactly one** league skips it and lands in that league;
  `/dashboard/fantasy?all=1` is the way back (the league page's "All leagues" link).
- `/dashboard/fantasy/[league]` is a league. Before the draft it shows managers, pending
  invites, and the commissioner's invite/rename/visibility/remove controls. A manager in
  several leagues gets a league switcher in the header. Later slices hang the pages above
  off it as tabs.
- Until fantasy launches, the tab and pages are open only to staff, or to everyone when an
  admin sets Fantasy to **shown** in the nav tab overrides.

---

## 14. Implementation notes

- **Real draft round:** `players.draft_round` (0 = captain, 1, 2), written by `execStartDraft`
  and `completePick` (`scripts/draft-round-migration.sql`). Auto-balance has no rounds, so only
  its captains get one; everyone else there tiers by the rating thirds.
- **Points are derived, not stored** — from `player_game_stats` (per player, per game) plus
  `matches` (round, score, series length). The same discipline as `app/lib/career-points.ts`.
  The scoring formula should live in a pure leaf module with tests.
- **Slot credits are stored; points are not.** Who filled which slot depends on the lineup at
  the moment a series was played, which can't be reconstructed later. So when a series is
  reported, write a `(league, manager, week, slot) → (player, match)` credit for every
  rostered player in an unfilled starting slot, with a unique key on
  `(league, manager, week, slot)` so the first credit wins under a race. Points are still
  computed on read from that credit's match stats.
- Locks are derived on read (`scheduled_at <= now` and the series not yet reported), so no
  cron is needed to start or end them. Every roster move checks them server-side.
- A fantasy season is its own `fantasy_seasons` row, not a `seasons` id: a running manual
  season has no `seasons` row until it's archived, and leagues have to exist before then.
- Built so far (`scripts/fantasy-leagues-migration.sql`): `fantasy_seasons`,
  `fantasy_leagues`, `fantasy_league_members`, `fantasy_league_invites`,
  `fantasy_league_removals`, and the locking `fantasy_join_league` function that enforces
  the manager cap.
- Draft (`scripts/fantasy-draft-migration.sql`): `fantasy_player_tiers` (tiers frozen per
  season at draft start), `fantasy_draft_picks`, `fantasy_roster_slots` (league, manager,
  slot, player — the one current lineup), `draft_order` / `current_pick` / `pick_deadline` on
  `fantasy_leagues`, and the `fantasy_draft_pick` function, which compare-and-swaps
  `current_pick` so two racing picks (a manager and an autopick) can't both land. Pick order,
  slot assignment and autopick choice are pure (`app/lib/fantasy-draft.ts`,
  `npm run test:fantasy-draft`); the server side is `app/lib/fantasy-draft-server.ts`.
  Autopick fires from the open draft room when the clock hits 0, with the
  `draft-autopick` cron as the backstop. The pick queue isn't built yet, so autopick goes
  straight to tier then rating.
- **Test runs** (`scripts/fantasy-test-run-migration.sql`): starting the drafts during a test
  event sets `fantasy_seasons.test_run`. A test run drafts only leagues whose managers are
  all staff or `test_` accounts, disbands nothing (every other league stays in `pre_draft`),
  and runs a 30-second pick clock. `resetSeason` calls `rollbackFantasyTestRun`, which
  deletes the run's picks, rosters and frozen tiers and puts the leagues back in `pre_draft`
  and the season back to `open`. With nobody to play a test event, Simulate writes made-up
  `player_game_stats` for each simulated series (`app/lib/fake-series-stats.ts`,
  `npm run test:fake-series-stats`), only while a test event is active and stats tracking
  is on. Those rows never reach career stats, the same as any test event's. Every fantasy
  table built later (slot credits, matchups, waivers, trades) needs a delete in the
  rollback too. The rollback leaves league memberships alone, so test accounts left in a
  league will join the real draft.
- **Matchups** (`scripts/fantasy-matchup-migration.sql`): `fantasy_slot_credits` is the one
  stored table. `creditFantasySlots` (`app/lib/fantasy-credits.ts`, its own module so
  `discord-bot.ts` doesn't import the league code) runs from `execReportMatchResult` on every
  non-forfeit group-stage result, and from Simulate's batch hook too, since Simulate writes
  `completed` directly and bypasses the reporter. It credits each starter on either team
  from the lineups as they stand at that moment, and `ignoreDuplicates` keeps the first
  credit. The credit cascades on `match_id`, and `rollbackFantasyTestRun` deletes it by league.
  The schedule is not stored: `app/lib/fantasy-schedule.ts` (pure,
  `npm run test:fantasy-schedule`) builds the round robin from `draft_order`, then the
  standings and playoffs from weekly totals, on every read (`app/lib/fantasy-matchup-server.ts`).
  **So the playoff seeding is also derived on read**, and a stat edit or re-reported series
  that changes the regular-season standings reshuffles the bracket, even after the
  semifinals are played. That's acceptable while results are rarely edited. If it starts to
  matter, freeze the seeds into a `fantasy_matchups` table when the regular season closes.
  The board's win odds (`winChance` in the same module) treat banked points as fixed and each
  starter still to play as their projection ± `SLOT_SPREAD` (35%) of it, under a normal
  approximation. That 35% is a guess and should be fitted once there are scored weeks.
  Each slot is drawn as its points (0 until played) over a pill holding the projection for
  that slot's own series (`PoolPlayer.matchProjected`, built with `getPoolView(…, { byMatch: true })`).
  A played week's projection is rebuilt from the history as it stood before it, by removing
  every game from that week on, so a scored slot is measured against what was predicted, not
  hindsight. Team ratings are today's, not that week's, which is the remaining drift.
- **Waivers** (`scripts/fantasy-waivers-migration.sql`): `fantasy_waivers` (one row per league
  and player, with `clears_at`) and `fantasy_waiver_claims` (`pending` → `won`/`lost`/`failed`/
  `cancelled`, one pending claim per manager per player), plus `waiver_order` and
  `waivers_ran_at` on `fantasy_leagues`. `scripts/fantasy-claim-rank-migration.sql` adds
  `fantasy_waiver_claims.rank`. Claims filed before it have a null rank and sort after ranked
  ones, by filing time. The rules are in the pure `app/lib/fantasy-waivers.ts`
  (`npm run test:fantasy-waivers`): `waiverClearsAt`, `waiverOrder`, `settleClaims`,
  `orderAfterRun` and `swapInProblem`. The database side is in `app/lib/fantasy-waivers-server.ts`.
  - **Players are not settled one at a time.** Every claim in a run shares the same 4 AM
    `clears_at`, so "oldest first" was a tie broken by row order. That order decided who got
    which player and how the waiver order moved. The rounds-by-manager run makes the result
    independent of the order players are returned in.
  - A new claim gets the next rank after the manager's other pending claims. The Roster tab's
    arrows rewrite all of them (`rankClaims`).
  - `creditFantasySlots` puts the reported series' unrostered pool players on waivers. It
    imports only the pure leaf, so `discord-bot.ts` still doesn't pull in league code.
  - **A waiver row holds the player until the run deletes it, even after `clears_at`
    passes.** Otherwise a free-agent add could slip in between 4:00 and the run and jump
    every pending claim.
  - An add or claim swaps the new player into the dropped player's slot with a single
    `update … where player_id = drop`. The roster unique index makes a race lose cleanly
    ("Another manager just got him"). Zero rows updated means the roster changed under the
    manager. The dropped player goes on waivers.
  - **Locks:** an instant add can't bring in or drop a player whose series has started.
    A claim checks the locks only when the run settles it (`settleClaims` takes the locked
    set), not when it's filed.
  - **The run** rides the per-minute `/api/cron/clip-reset` pinger, with no new Vercel cron,
    since a fixed UTC cron would drift an hour across daylight saving. Each tick computes the
    last 4 AM Pacific boundary. For each active league it claims the run with a
    compare-and-set on `waivers_ran_at`, so only one tick processes a league per day. It
    settles every row with `clears_at <= boundary`, then rewrites `waiver_order` when anyone
    won. The new order counts only the swaps that actually saved, so a claim that loses a
    race at write time doesn't cost its manager priority.
  - `rollbackFantasyTestRun` deletes both tables by league and nulls the two league columns.
- **Trades** (`scripts/fantasy-trades-migration.sql`): `fantasy_trades` (`pending` →
  `accepted`/`rejected`/`cancelled`/`failed`, with a `note`) and `fantasy_trade_items`
  (trade, player, the manager giving him up). The like-for-like check and the slot pairing are
  pure (`app/lib/fantasy-trades.ts`, `npm run test:fantasy-trades`). The database side is
  `app/lib/fantasy-trades-server.ts`.
  - Slots are paired at acceptance, from both lineups as they are then, so a pending trade
    never goes stale over a bench swap.
  - The `fantasy_accept_trade` function does the swap in one transaction. It locks the league
    row so two accepts in the same league can't interleave. It checks that every outgoing
    player is still in the slot the server read and returns `stale` if not. Then it deletes
    all the traded rows before reinserting them, because the roster's unique keys would reject
    a row-by-row move. In the same transaction it cancels every other pending trade that
    includes a moved player.
  - Locks are checked in the server action before the call, and a locked player leaves the
    trade pending.
  - `rollbackFantasyTestRun` deletes trades by league. Items cascade.
- **The freeze** (§7) is derived on read like the rest of the schedule, so it needs no
  table. `eliminatedManagers` in `app/lib/fantasy-schedule.ts` (pure, `npm run
  test:fantasy-schedule`) reads a built schedule: nobody before the regular season closes,
  then everyone outside the first playoff week's matchups, then the semifinal losers, and
  everyone once the last week closes, champion included, since nothing is left to play for.
  `eliminatedInLeague` in `app/lib/fantasy-matchup-server.ts` feeds it the same inputs as the
  Matchup tab, and skips reading any scores until the regular season has closed.
  - Adds and claims are refused in `checkMove`. At the run, a frozen manager's claims fail
    with a note rather than being settled, so they can't win a player.
  - Proposing a trade is refused if either side is frozen. Accepting one calls it off.
  - Pending trades with a frozen side are cancelled with a note by the daily run and on every
    Players-tab load, so nobody is shown an offer they can't accept.
  - Lineup swaps stay open, and a frozen manager can still withdraw a claim.
- **Manager departure (§11)** is `app/lib/fantasy-departure-server.ts`, with
  `scripts/fantasy-manager-departure-migration.sql`.
  - An orphan is a `fantasy_league_members` row with `orphaned_at` set. The row stays, so the
    schedule's seats (members by `joined_at`) and the pool exclusion don't move.
  - `removeFromActivePlay` calls `orphanFantasyTeams`, so every kick and ban path covers it.
  - The act-checks treat an orphan as not a member: `isActiveManager`, `checkMove`, and the
    trades' member check.
  - A hand-over is an invite with `takeover_of` set. Accepting it runs
    `fantasy_hand_over_team`, which re-keys every manager-id column from the old account to
    the new one in one transaction.
  - It is refused while the league is drafting, because `fantasy_draft_pick` reads its
    manager before taking its lock.

---

## 15. Season end

A fantasy season is **officially complete when its event's archive is exported** from the
admin tab. It gets there in two steps, because the data fantasy scores from is destroyed
earlier, when the event is *completed*: `completeTournament` and `completeSeason` both end
in `resetSeason`, which deletes `matches`, and `fantasy_slot_credits` and
`player_game_stats` cascade with them.

Statuses (`scripts/fantasy-season-end-migration.sql`), on both the season and its leagues:
`active → ended → complete`, or `→ cancelled`.

**1. Event completed → `ended`.**
- `snapshotFantasySeason()` (`app/lib/fantasy-season-end.ts`) runs beside
  `computeFullArchive`, before the reset. For each active league it captures:
  - the final standings, in finishing order (`placedStandings`: the finalists lead), and the
    champion;
  - every week's matchups and lineups, exactly as the Matchup tab drew them;
  - the final rosters with each player's season points;
  - the draft board, so the league's history is complete.
- Managers and players carry their `discordId`, as the event archive does, since usernames
  change.
- The snapshot goes into the event's `full_archive` as `fantasy`. That way the Export
  button's JSON carries it, and the purge drops it, with no extra plumbing.
- Each league's copy is also written to `fantasy_leagues.summary`, with the weekly detail
  under `detail`, so the league pages never load the event's whole archive. The export
  strips `detail` (`withoutDetail`), leaving the permanent standings and champion.
- The season records `event_kind`/`event_id`, and it and its leagues move to `ended`. This
  happens before `resetSeason`, whose own cancel step only touches what is still running.
  - Leaving `active` is required, not cosmetic: `groupMatches()` reads every group-stage
    match in the database, so a still-active league would score the next event's Round 1.
  - Every mutator, the waiver run, the notice sweep and autopick already require
    `active`, so `ended` freezes them all.
- League pages read from the snapshot (`isFinalLeague`). The League tab shows final standings
  with a "final once the archive is exported" note; Matchup browses every week, ending on the
  final; Roster shows each manager's final roster and season points (with teams cleared, the
  live view would read every player as ineligible); Players is closed. Once the detail is
  dropped at export, Matchup and Roster point back to the League tab.
- A test event carries no snapshot and ends nothing: `rollbackFantasyTestRun` has already
  undone its run, and `resetSeason` skips the cancel while a test event is active.

**2. Archive exported → `complete`.**
- `purgeExportedArchive` moves the linked season and leagues from `ended` to `complete` in
  the same step that clears the archive. That step only runs once the JSON download is
  confirmed, so "complete" means the data is on disk, and a later PDF-only re-export changes
  nothing.
- The PDF report gains a fantasy section per league: its champion and final standings, from
  the archive's copy (or the stored summaries once the archive is purged).
- Managers get one "Fantasy season complete" notice under Results and playoffs
  (`completionNotices`).

**Ending without an archive.** Cancel Tournament on an active event, or the manual Reset
Season button, marks a running (non-test) fantasy season and its leagues `cancelled`. No
record is kept. Deleting an event whose archive was never exported cancels its `ended`
season the same way (`cancelFantasyForEvent`), since nothing could complete it any more.

**The next season** is opened by a director with the **Open season** control (a name) in the
Staff box on the fantasy hub, beside Start fantasy drafts. It shows once no season is
running. It's allowed once no season is `open`, `drafting` or `active`. An `ended` season
doesn't block it, since that season only waits on an export. `getCurrentFantasySeason` reads
only `open`, `drafting` and `active`; the hub falls back to the newest `ended` or `complete`
season (`getHubSeason`) so the last results stay visible until the next one opens.

**Profiles:** fantasy results are not shown on player profiles for now. They can be added
later from the stored summaries.

---

## Open questions

None at the moment.

**Decided: trades are disabled** rather than given a deadline or a veto window (§10). If they
are ever turned back on, the dumping problem returns: a manager out of contention but not yet
eliminated can send their best players to a friend, which the elimination freeze doesn't
cover. A deadline after Week 4 of 6, or a day-or-two veto window for the other managers, are
the options considered.

**Decided: no freeze for waivers before elimination is known.** Managers aren't eliminated
until Week 6 closes, but a Round 7 series can be played before then, so in that window a
soon-to-be-eliminated manager can still drop players onto waivers. Freezing waivers from the
first Round 7 lock was rejected: Round 7 starts early enough that the freeze would block
ordinary moves for days, and a manager who claims a dropped player has played it smart.
