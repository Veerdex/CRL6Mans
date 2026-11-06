# Fantasy Rocket League — Design Spec

Status: **design agreed, not yet built.** Living document — edit as decisions change.
Origin: Kotala's proposal + the design discussion of 2026-11-05/06. Anything marked
*(assumed)* was filled in without an explicit decision; anything in
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
| Creating | Each person can **create one** league per season |
| Joining | A person can be in **multiple** leagues |
| Size | **4–6 managers.** If the real season has **21 or fewer teams**, max is **4** |
| Visibility | Commissioner sets **public** (listed, anyone can join) or **private** (invite only) |
| Viewing | Anyone can view any other league, **public or private** (read-only) |
| Undersized | A league with **fewer than 4 managers** when the admin starts the drafts is **disbanded** |
| End of season | League is archived read-only |

### Commissioner (league creator) powers
- Rename the league
- Set public / private
- Remove managers **before the draft**

Commissioners cannot force-close weeks or override results — that is staff only.

### Leaving a league
- **Before the draft:** allowed.
- **During the draft:** not allowed.
- **After the draft:** allowed. See [Manager departure](#11-manager-departure).

---

## 3. Player pool and tiers

### Who is draftable
Every approved player in the real season (drafted rosters and the free-agent/sub pool),
**except the managers of that league.** A manager can never draft, claim, add or receive in a
trade themselves or any other manager in their own league — those players are never shown as
options.

### Tiers
| Tier | Drafted players | Free agents (not on a real team at season start) |
|---|---|---|
| Tier 1 — Captain | Real team captains | Top ⅓ by rating |
| Tier 2 — 1st round | Real 1st-round picks | Middle ⅓ by rating |
| Tier 3 — 2nd round | Real 2nd-round picks | Bottom ⅓ by rating |

- Rating = RV (`app/lib/rating.ts`), compared against all players in the season.
- A player's tier is **fixed for the season** once assigned *(assumed — matches captain
  stability)*.
- **Prerequisite:** the site doesn't currently record which round a player was drafted in.
  Needs a column written at pick time.

---

## 4. Rosters

- **8 players: exactly 2 Tier 1, 3 Tier 2, 3 Tier 3.**
- Tier limits apply **all season**, not just in the draft. Every roster move is like-for-like:
  - A Tier 1 can only be swapped for a Tier 1, Tier 2 for Tier 2, Tier 3 for Tier 3.
  - This applies to free-agent adds, waiver claims and trades.

### Weekly lineup
6 starters + 2 bench:

| Slot | Eligible |
|---|---|
| Cap | Tier 1 |
| 1st ×2 | Tier 2 |
| 2nd ×2 | Tier 3 |
| Flex | Any tier |
| Bench ×2 | The remaining two |

- UI: the position button shows **Cap / 1st / 2nd / Flex**; pictures are Discord avatars.
- **Each week's lineup copies the previous week's by default.**

---

## 5. Scoring

### Per-player series points
```
points = 20 × MVP(own-team games, N) + bonus × (games played ÷ N)    [bonus only if his team won]

MVP(games, N) = ((G + A + Sv + Sh÷10) ÷ (N × 4)) + Sc ÷ N ÷ 1000
bonus         = wins needed − games his team lost
```
- `N` = **number of games in the series**, not games the player played. A player who played
  1 game of a 5-game series has his 1 game's stats divided by 5.
- Same MVP formula as the Stats page (`app/lib/stats-math.ts`), so a 3-game and 5-game series
  compare fairly.
- **Win bonus** — best-of-5: 3-0 = +3, 3-1 = +2, 3-2 = +1. Best-of-3: +2 / +1. Best-of-7:
  +4 / +3 / +2 / +1. Prorated by games played.
- **Subbing for another team earns nothing** — only games played for his own team count.

**Example:** Player A plays game 1 of a 3-2 win, a sub plays games 2–5.
A scores `20 × MVP(game 1 stats, N=5) + 1 × (1 ÷ 5)`.

### Weekly matchup
A manager's weekly total = sum of his 6 starters' points for that week. Higher total wins.

### Special cases
| Case | Score | Locks? |
|---|---|---|
| Normal series | Formula above | Locks when reported |
| Forfeited series | 0 | **No** — slot stays swappable |
| Real team on bye | 0, shown with a **BYE** tag | **Never** — swappable all week |
| Player kicked / banned / left the league | 0, obvious **ineligible** indicator | Replace with an unlocked same-tier player |
| Didn't play (sub covered all games) | 0 | Locks when reported |

### Late changes
Points are **computed on read** from current stats, the way career points are — never
stored. A resolved unmatched replay player, a dispute or an admin stat edit updates fantasy
points automatically.

---

## 6. Fantasy weeks and locking

- **Fantasy week N = real group-stage Round N.** A series always counts toward the round it
  belongs to, regardless of when it's played — so out-of-order rounds (Round 2 played before
  Round 1) are handled.
- Several fantasy weeks can be open at once. Lineups are **per week**.
- **A player locks for a given week when his series for that round is reported.** Locked
  starters and locked bench players stay where they are for that week.
- **A swap requires both players to be unlocked** for that week.
- A player whose series for a week is already reported **cannot be put into** that week's
  lineup. He can still be added to a roster, but only for later weeks.
- **Exception:** a forfeited series doesn't lock its players, so a forfeited starter can be
  swapped for any unlocked player (bench or free agent).
- Dropping a player keeps any points he scored in weeks that had already locked.
- **A week closes when every series in that round is final** (reported, forfeited or
  cancelled). Staff can force-close a week whose series is never played.

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
- **Trade deadline:** trading closes at the start of the semifinal week.
- **Eliminated managers are frozen:** no adds, drops, waiver claims or trades.

| | Regular season | Playoffs, still alive | Eliminated |
|---|---|---|---|
| Set lineups | ✅ | ✅ | — |
| Waivers / free agents | ✅ | ✅ | ❌ |
| Trades | ✅ | ❌ (past deadline) | ❌ |

The deadline and the freeze stop an eliminated manager from feeding his players to a manager
still in the playoffs (by trade or by dropping them onto waivers).

---

## 8. Draft

- **Admin starts every league's draft at once**, manually, after the real draft and before
  Round 1. Leagues with fewer than 4 managers are disbanded at that moment.
- **Order: season draft → fantasy draft → season starts.** The admin can't start the real
  season while any fantasy draft is in progress, so no Round 1 series can be played before
  every fantasy draft has finished.
- **Snake draft, order randomized** when the draft starts.
- **10 minutes per pick.**
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
- A successful claim moves that manager to the **back** of the order. Everyone else moves up.
- When several managers claim the same player, the highest priority wins.

---

## 10. Trades

- **Any size**, as long as each side gives up the same tiers it receives (keeps both rosters
  at 2/3/3).
- One manager proposes; the other **accepts or rejects**.
- **Every player in the trade must be unlocked** for the current week.
- If a player in a pending trade **locks**, the trade can't be accepted, only rejected. It
  becomes **acceptable again when the next week opens**.
- **Trade deadline:** start of the semifinal week.

---

## 11. Manager departure

Leaving after the draft, or being kicked or banned from the site:
- That manager's team **scores 0 every week** for the rest of the season. Opponents still play
  it.
- All his players **go on waivers.**
- He no longer counts toward playoff spots:
  - **3 managers left** at the semifinals → the top seed has a bye.
  - **2 left** → both have a bye in the semifinals and meet in the final.
  - **1 left** → that manager **wins the league automatically**, at any point in the season.

---

## 12. Notifications

Fantasy gets its **own notification section** with its own toggles, separate from the
league's. Proposed list:
- Draft starting / you're on the clock / autopicked for you
- Waiver claim won or lost (daily run results)
- Trade proposed, accepted or rejected
- A rostered player is on bye, or became ineligible, for an upcoming week
- Weekly matchup result
- Playoff seeding and elimination

---

## 13. UI pages

Modelled on fantasy football so it's familiar:
- **My Roster** — lineup by week with slot buttons (Cap / 1st / 2nd / Flex / Bench), lock
  icons, BYE and ineligible tags, Discord avatars. No projections or next-game stats.
- **Matchup** — the two lineups side by side with points per player (like Kotala's mockup).
- **Players / Waiver wire** — free agents and waiver players, with tier, status
  ("Free agent — Add" / "Waivers — clears in 14h — Claim") and trending.
- **Standings** — W-L, total points, waiver priority.
- **Trades** — proposals sent and received.
- **Draft room** — live board, queue, pick timer.
- **League directory** — public leagues to join or view; create a league.

---

## 14. Implementation notes

- **Missing data:** record each player's real draft round (captain / round 1 / round 2) at
  pick time.
- **Points are derived, not stored** — from `player_game_stats` (per player, per game) plus
  `matches` (round, score, series length). The same discipline as `app/lib/career-points.ts`.
  The scoring formula should live in a pure leaf module with tests.
- Likely tables: `fantasy_leagues`, `fantasy_league_members`, `fantasy_player_tiers`,
  `fantasy_roster_slots`, `fantasy_lineups` (league, manager, week, slot, player),
  `fantasy_matchups`, `fantasy_waiver_claims`, `fantasy_trades` + `fantasy_trade_items`,
  `fantasy_draft_picks`.
- The waiver run should be checked on every tick of the existing per-minute external pinger
  (like `clip-reset`), running once when 4 AM Pacific has passed and today's run hasn't happened.
  A fixed UTC Vercel cron would drift an hour across daylight saving. Fantasy shouldn't need
  Vercel Pro outside draft week.

---

## Open questions

1. **Pending trades** — can the proposer cancel? What happens to pending trades at the
   deadline? *(assumed: proposer can cancel; pending trades expire at the deadline)*
2. **Mid-season team changes** — a player moved to another real team keeps his tier
   *(assumed)*. Does anything else change?
