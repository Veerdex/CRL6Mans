# Fantasy RL — Points Projections

How fantasy points are scored, and how a player's points are predicted ahead of a series.
Scoring rules live in [fantasy-rl.md §5](fantasy-rl.md#5-scoring); this doc is the math
behind them and the plan for calibrating it.

**Status:** design only, nothing implemented. Every number below is a v1 starting value fitted
on `seeded_player_stats` (Nov 2026). This month's tournament records live stats, and those
results recalibrate the constants. **Calibration changes constants only — no features.**

Adapted from an external spec (*Rocket League Player-Stat Prediction and Over/Under Market
Specification*, v1.0). Its betting sections (lines, odds, margin, bet placement, settlement)
don't apply to fantasy and are dropped.

---

## 1. Per-game fantasy points (FP)

```
FP = (Sc + 250·G + 85·A + 60·Sv + 10·Sh) / 660
```

Per-game stats: score, goals, assists, saves, shots. A series is scored as
`20 × FP + win bonus` (see fantasy-rl.md §5), so a median player earns ≈ 20 stat points.

### How the weights were chosen
1. **Targets.** Each stat should be worth a set number of points to the average player per
   game: goals 5, saves 3.5, assists 1.5, shots 1.
2. **Leftover score.** In-game score already rewards each stat, so that part is subtracted
   and the remainder scores separately:
   `(Sc − (100·G + 50·A + 62.5·Sv + 10·Sh)) / 50`.
   The 100 / 50 / 62.5 / 10 are estimates of how much score each stat produces.
3. **Weights** = target ÷ league average per game (139 players with ≥ 10 games):
   goal 6.872, assist 2.730, save 2.419, shot 0.386.
4. **Simplify.** The leftover term cancels into the weights:
   `4.872·G + 1.730·A + 1.169·Sv + 0.186·Sh + Sc/50`. Rounding gives
   `5·G + 1.7·A + 1.2·Sv + 0.2·Sh + Sc/50`. That is ×50 to whole numbers, then ÷ 660 instead
   of ÷ 50, so the league's median player sits at 1.00.

Rounding barely moves anything. Against the unrounded weights the rank correlation is
0.9998, and no player moves more than 4 places.

**The weights are fixed constants**, not recomputed from each event's averages. They are
easier to read and explain, but the stat targets drift slightly as the league's stats change.

### How it compares (registered players, ≥ 10 games)
| Rank correlation | vs MVP | vs RV |
|---|---|---|
| Stats-page MVP | — | 0.88 |
| FP | 0.95 | 0.85 |

Per-game stat vs RV (rank correlation): goals 0.75, shots 0.72, saves 0.61, assists 0.28.

---

## 2. Projecting a player's per-game stats

Each stat is projected separately. **Stats:** score, goals, assists, saves, shots.

### Step 1 — Rating estimate (from RV)
```
ratingEstimate(s) = max(0, leagueMean(s) + slope(s) × (RV − 1722.4))
```
RV comes from `calculatedRatingFromRow()` in `app/lib/rating.ts`.

Fitted on the 30 registered players with ≥ 10 games and MMR on file:

| Stat | leagueMean (per game) | slope (per RV point) | r with RV | Spec's slope (96 players) |
|---|---|---|---|---|
| Score | 345.55 | 0.3810 | — | — |
| Goals | 0.70027 | 0.000928 | 0.73 | 0.000937 |
| Assists | 0.52663 | 0.000185 | 0.24 | 0.000314 |
| Saves | 1.35992 | 0.001646 | 0.67 | 0.001464 |
| Shots | 2.47082 | 0.002389 | 0.72 | 0.002740 |

The spec appears to have been fit on this same league with more players. Its slopes agree
closely, which supports these values. The spec has no score model, so all five values here
come from our own fit.

The score row was refit on 2026-11-07. Two seeded events
(`191198e6-…`, `d600c105-…`) recorded no score at all, and counting their zeros had
dragged the mean down to 299.32 and the slope to 0.30220. The other four stats are unchanged.

### Step 2 — Blend with the player's history
```
w        = games / (games + 10)
baseline = w × historicalPerGame(s) + (1 − w) × ratingEstimate(s)
```
- 0 games → w = 0 (rating only). 10 games → 0.5. 50 games → 0.83.
- History = `seeded_player_stats` **plus** live `player_game_stats`, combined.
- **Score history skips seeded events with no score recorded** (a seeded row with games > 0
  and score 0). For score, `games` is the number of games that did record one (`scoreGames`).
- **No MMR on file** (`hasMmrOnFile` false): use history alone if there is any. With neither
  history nor MMR, use the league means.
- **Labels** (from the spec): w = 0 is *rating only*, 0 < w < 0.5 is *provisional*,
  w ≥ 0.5 is *history weighted*.

### Step 3 — Matchup adjustment
This replaces the spec's ±10% per-stat dominance (§10), which barely moved a heavy
favourite. All five projected stats are multiplied by one factor taken from `pSeries`, the
player's team's chance of winning their next series:
```
edge  = 2·pSeries − 1                       −1 … 1
swing = |edge|^1.75
edge ≥ 0:  multiplier = 1 + 0.5 × swing     1.0 → 1.5
edge < 0:  multiplier = 1 − 0.9 × swing     1.0 → 0.1
```
| pSeries | 0% | 10% | 25% | 50% | 75% | 90% | 100% |
|---|---|---|---|---|---|---|---|
| multiplier | 0.10 | 0.39 | 0.73 | 1.00 | 1.15 | 1.34 | 1.50 |

It is pinned at 1 for an even series, so the league isn't projected low on average. A single
line from 0.1 to 1.5 would put an even series at 0.8. The curve is flat near even, so a modest
favourite barely moves, and it swings hard only when a series is lopsided. The win bonus is not
multiplied, since it already depends on the matchup.

The **RV update applies the same multiplier** to the FP it measures a series against. Each
team's rating there is `initialTeamRating` of its roster's decision ratings, read before the
series' adjustments land. A favourite's padded stats therefore aren't read as the player
outplaying their rating. A player on neither roster (a sub) is judged as in an even series.

The endpoints are a judgement call, not a fit. They're among the first things to refit in §4.
A player with no next match (a free agent, or a team with nothing scheduled) projects as an
even matchup. That means a multiplier of 1 and the even win bonus at the season's default
series length.

---

## 3. Projecting series points

**Stat points:** combine the per-stat projections with the scoring formula.
```
projectedFP         = (Sc + 250·G + 85·A + 60·Sv + 10·Sh) / 660    ← projected per-game values
projectedStatPoints = 20 × projectedFP
```
The stats are per-game averages, so series length doesn't change this part. The
projection assumes the player plays every game for their own team.

Because the formula is linear, this equals projecting FP directly:
`0.9477 + 0.001019 × (RV − 1722.4)`, which has R² = 0.70 against RV.

**Expected win bonus:** use `predictSeries()` with each team's `resolveTeamRating()`.
```
expectedBonus = Σ over the team's winning scorelines  P(scoreline) × (winsNeeded − gamesLost)
```
Example: an even best-of-5 gives 0.125 × 3 + 0.1875 × 2 + 0.1875 × 1 = **0.94**.

```
projectedSeriesPoints = projectedStatPoints + expectedBonus
```

**Bye, or a forfeit known in advance:** 0.

### Worked example — Veerdex (RV 1689, 41 games)
| | Score | Goals | Assists | Saves | Shots |
|---|---|---|---|---|---|
| Rating estimate | 289.2 | 0.669 | 0.521 | 1.305 | 2.391 |
| History | 326.8 | 0.683 | 0.488 | 1.195 | 2.293 |
| Blend (w = 41/51 = 0.80) | 319.4 | 0.680 | 0.494 | 1.217 | 2.312 |

projectedFP = (319.4 + 170.1 + 42.0 + 73.0 + 23.1) / 660 = 0.951, so
**stat points ≈ 19.0**. In an even best-of-5, add 0.94 for **≈ 19.9 series points**.

---

## 4. Calibrating after this month's tournament

Save every prediction made before a series alongside the actual result. Store the RV, team
ratings, win probability, format, projected stats and FP, and the actual stats and FP. Then
refit in this order (from the spec):
1. Rating → stat means and slopes.
2. The shrinkage constant (10 games).
3. Matchup adjustments, if the data supports them.

Measure mean absolute error and RMSE of series points, broken down by:
- stat
- rating band
- games-of-history band
- favourite vs underdog

**Fit on earlier matches and test on later ones**, so no future information leaks into the
fit.

---

## 5. Implementation notes

- A pure leaf module, `app/lib/fantasy-projection.ts`, with no Supabase import, plus a
  `node --test` suite — the same pattern as `rating.ts` and `draft-order.ts`.
- Put the constants in one place with a model version string, for example
  `fantasy-proj-v1`, so a refit is a single-file change.
- Keep full precision in calculations. Round only for display: per-game values to 3
  decimals, series points to 1–2.

## 6. Limitations

- **Small fitting sample:** 30 players with RV. Their stats come from past seasons, while
  their MMR is what they report now.
- **No opponent styles or overtime** are modelled.
- **Subs:** the projection assumes the player plays every game.
- **Psyonix licence:** the source spec notes that Psyonix's community licence restricts
  using tournament player data for fantasy esports. Worth checking before fantasy launches.
