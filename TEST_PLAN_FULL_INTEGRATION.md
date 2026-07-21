# Full Integration Test Plan: CRL 6Mans Platform

## Overview
This test plan covers an end-to-end tournament lifecycle with 12 real players across 4 teams. Players will register, enter a tournament, get drafted into teams, place bets on matches, and compete in a full season with match reporting, rankings, and final standings.

**Test Duration:** 2–4 hours (depending on match play time)
**Participants:** 12 test players + 2–3 staff members (admin + director/CEO)

---

## Phase 0: Setup & Environment Preparation

### Prerequisites
- [ ] Deployed code is live on production or staging
- [ ] All required environment variables are set (Discord, Supabase, etc.)
- [ ] Test Discord server is ready with bot added and permissions configured
- [ ] Bot's role is positioned at the top of the role hierarchy
- [ ] 12 test Discord user accounts created or ready
- [ ] Test database is clean or rollback plan is prepared

### Configuration Steps
1. **Seed staff hierarchy**
   - [ ] One user assigned as CEO or Director (for administrative actions)
   - [ ] One user assigned as Moderator (for moderation testing)
   - [ ] Use `/assignrole` or insert directly into `staff_roles` table

2. **Configure Discord channels**
   - [ ] Set draft announcement channel via `/setdraftchannel` in target channel
   - [ ] Set rules/documentation channel via `/setruleschannel` in target channel

3. **Set up roles** (new feature)
   - [ ] Create Discord role called `Registered`
   - [ ] Run `/setregisteredrole` to link it to the bot
   - [ ] Ensure bot's role sits above it

4. **Create team roles**
   - [ ] Create 4 Discord roles: "Team 1", "Team 2", "Team 3", "Team 4"
   - [ ] Ensure all sit below the bot's role in hierarchy

5. **Configure tournament/season settings**
   - [ ] Set up tournament format (Best of 3 / 5, bracket type, etc.)
   - [ ] Configure push notification settings
   - [ ] Set betting windows (match deadline, etc.)

6. **Run `/syncroles`**
   - [ ] Verify no errors in response
   - [ ] Verify channels are created for the season

---

## Phase 1: Player Registration (In-App)

### Test Scenario: 12 Players Register

#### 1.1 Pre-Registration Check
- [ ] Visit `/dashboard/register` unauthenticated
- [ ] Expected: Redirected to login (Discord OAuth)

#### 1.2 Registration Flow (Per Player — 12x)

For each of the 12 test players:

1. **OAuth Login**
   - [ ] Click "Sign in with Discord"
   - [ ] Expected: Redirected to Discord, then back to `/dashboard/register`

2. **Submit Registration Form**
   - [ ] Fill in:
     - Peak 2v2: 1200–1800 (vary per player)
     - Current 2v2: 1000–1700
     - Peak 3v3: 1000–1600
     - Current 3v3: 900–1500
     - Tracker URL: valid RL tracker link
     - College ID: upload an image
     - Sub Willing: yes/no (mix of both)
   - [ ] Click "Submit"
   - [ ] Expected:
     - Success message: "Your registration is pending admin review"
     - DM from bot: "Thanks for registering"
     - Push notification to admins: "New Registration"

#### 1.3 Admin Approval (Batch)
1. **Admin navigates to `/dashboard/admin`**
   - [ ] View "Pending Registrations" panel
   - [ ] Expected: All 12 players listed

2. **Approve each player**
   - [ ] Click "Approve" for each player
   - [ ] Expected (per approval):
     - Player status → "approved"
     - Player receives `Registered` Discord role
     - Player can now access `/dashboard` pages

3. **Verify Discord roles**
   - [ ] Each player has `Registered` role
   - [ ] Check in Discord server member list or user profile

**Post-Phase 1 State:**
- 12 approved players in DB
- All have `Registered` Discord role
- All can access player dashboard

---

## Phase 2: Tournament Signup & Setup

### Test Scenario: Create & Configure Tournament

#### 2.1 Create Tournament (Admin)
1. **Admin navigates to tournament creation**
   - [ ] Select "New Tournament" from Admin panel
   - [ ] Fill in:
     - Name: "Test Tournament – Integration Test"
     - Join Mode: `players` (individual signup, not teams)
     - Format: `snake_draft` (live draft) or `auto_balance` (auto-assign)
     - Best-of: 3 or 5
     - Dates: Today → Tomorrow
   - [ ] Save
   - [ ] Expected: Tournament created with status `scheduled`

#### 2.2 Open Signups
1. **Admin opens signups**
   - [ ] Toggle "Signups Open"
   - [ ] Expected:
     - Push notification to all players: "Signups are open!"
     - `/dashboard` shows "Join Tournament" button for all approved players

#### 2.3 Players Sign Up
1. **Each of 12 players joins**
   - [ ] Login to `/dashboard`
   - [ ] Click "Join Tournament"
   - [ ] Expected:
     - Player added to `tournament_entries`
     - Button changes to "You've entered"
     - Signup counter increments

**Post-Phase 2 State:**
- Tournament has 12 signups
- All players marked `draft_entered: true`

---

## Phase 3: Draft or Auto-Balance

### Test Scenario A: Snake Draft

#### 3.1 Activate Draft
1. **Admin starts draft**
   - [ ] Click "Start Draft" in Admin panel
   - [ ] Expected:
     - Tournament status → `active`
     - `/dashboard/draft` shows live draft board
     - Push to all players: "Draft is live!"
     - Draft announcement posted in Discord draft channel
     - First captain announced with 45-second timer

#### 3.2 Live Draft Picks (Test Picks for 4 Teams of 3 Each)
1. **Captain 1 (highest RV) picks**
   - [ ] Admin/test script picks first player from pool
   - [ ] Expected:
     - Player moves to Team 1 on draft board
     - Cron/client autopick timer counts down (45s)
     - Next captain announced

2. **Repeat for 12 total picks**
   - [ ] 4 rounds × 3 teams = 12 players assigned to teams
   - [ ] Each pick updates live board in real-time

#### 3.3 Post-Draft State
- [ ] All 12 players assigned to 4 teams (3 per team)
- [ ] Captains identified (highest RV per team)
- [ ] Teams have `Drafted` and `Captain` Discord roles assigned
- [ ] Each team has their team Discord role assigned

### Test Scenario B: Auto-Balance (Alternative)
1. **Skip manual draft, enable auto-balance**
   - [ ] Admin toggles auto-balance
   - [ ] Expected: Teams auto-assigned by RV balancing algorithm
   - [ ] Same post-draft state as above

**Post-Phase 3 State:**
- 4 teams formed, each with 3 players
- Discord roles assigned: Drafted, Captain, Team 1–4
- Season ready to begin

---

## Phase 4: Tournament Schedule & Match Creation

### Test Scenario: Season Begins, Matches Scheduled

#### 4.1 Season Start
1. **Admin starts the season**
   - [ ] Click "Start Season" in Admin panel
   - [ ] Expected:
     - Tournament status → `active` (if not already)
     - Match channel categories created (Group Stage, Quarterfinals, etc.)
     - First round matches scheduled
     - Push notification: "Season has started!"
     - Bot posts match schedules in respective channels

#### 4.2 Match Creation
1. **Verify match channels**
   - [ ] Navigate to Discord categories for each round
   - [ ] Expected:
     - Each match has a private channel (e.g., `#team1-vs-team2-g1`)
     - Channel visible only to both teams + bot + staff
     - Channel pinned with match info (teams, deadline, scoring instructions)

2. **Verify match records in DB**
   - [ ] Query `matches` table
   - [ ] Expected:
     - 6 matches total for Round 1 (assuming group stage: 2 groups × 3 matches per group, or bracket format)
     - Each match has: home_team_id, away_team_id, scheduled_at, status (pending/scheduled)

**Post-Phase 4 State:**
- Matches created and scheduled
- Discord channels live
- Players can see match info

---

## Phase 5: Betting System

### Test Scenario: Players Place Bets on Matches

#### 5.1 View Betting Interface
1. **Players navigate to `/dashboard/wagers`**
   - [ ] Login as a player
   - [ ] Expected:
     - List of upcoming matches with prediction cards
     - Moneyline odds (Team A wins, Team B wins)
     - Over/Under lines (e.g., Over 2.5 games)
     - Parlay options
     - Bet slip with accumulator

#### 5.2 Place Bets (Test Multiple Bet Types)

1. **Moneyline Bet**
   - [ ] Select "Team 1 to win" on a match
   - [ ] Input amount (e.g., 50 coins)
   - [ ] Expected:
     - Odds multiplier shown (e.g., 1.85x)
     - Max payout calculated
     - Bet added to slip

2. **Over/Under Bet**
   - [ ] Select "Over 2.5 games"
   - [ ] Input amount
   - [ ] Expected: Bet added to slip with correct odds

3. **Parlay Bet**
   - [ ] Select multiple outcomes from different matches
   - [ ] Input total amount
   - [ ] Expected: Combined odds multiplier calculated (multiplicative)

4. **Submit Bets**
   - [ ] Click "Place All Bets"
   - [ ] Expected:
     - Bets inserted to `wagers` table with `odds_multiplier` snapshotted
     - Wager status: `pending`
     - Coins deducted from player balance
     - Confirmation shown

#### 5.3 Verify Betting Restrictions
1. **Own-team betting restriction**
   - [ ] Try to place a bet on own team's match
   - [ ] Expected: Button disabled with message "Can't bet on your own team"

2. **Closed match restriction**
   - [ ] Try to bet on match past deadline
   - [ ] Expected: Betting disabled for that match

**Post-Phase 5 State:**
- Multiple wagers placed across different players
- Odds snapshotted per wager
- Coins deducted from balances

---

## Phase 6: Match Play & Result Reporting

### Test Scenario: Matches Played, Captains Report Scores

#### 6.1 Match 1: Team A vs Team B (Best of 3)

1. **Simulate Play**
   - [ ] Teams play 3 games (or until winner is determined)
   - [ ] Outcome: Team A wins 2–1

2. **Captain Reports Result**
   - [ ] Team A captain uploads a replay file (or inputs score manually)
   - [ ] Expected:
     - Match channel shows score proposal
     - Other team captain asked to confirm
     - Buttons: Confirm / Dispute / Escalate

3. **Opponent Confirms**
   - [ ] Team B captain confirms the score
   - [ ] Expected:
     - Match status → `completed`
     - Bets on this match resolved:
       - Team A moneyline bets → win
       - Team B moneyline bets → loss
       - Over/Under payouts calculated based on series length (2 games played)
     - Player balances updated with winnings
     - Captains notified of final score

#### 6.2 Resolve Remaining Matches
1. **Repeat for remaining matches** (5 more in round 1)
   - [ ] Vary outcomes (some sweeps, some close matches)
   - [ ] Some captains take time to report (test match timeout handling)
   - [ ] Test one disputed score (escalated to staff)

#### 6.3 Verify Betting Payouts
1. **Check wager resolution**
   - [ ] Query `wagers` table for resolved bets
   - [ ] Expected:
     - Status → `won` or `lost`
     - Payout amount = amount × odds_multiplier (for wins)
     - Player `crl_coins` balance reflects wins/losses

2. **Check player ledger**
   - [ ] Each player's coin balance updated
   - [ ] Winning bets show green (+coins)
   - [ ] Losing bets show red (-coins)

**Post-Phase 6 State:**
- All Round 1 matches completed
- Betting results settled
- Player coin balances updated
- Season rankings updated

---

## Phase 7: Season Progression & Rankings

### Test Scenario: View Standings, Advance to Next Round

#### 7.1 View Standings
1. **Navigate to `/dashboard/season`**
   - [ ] Expected:
     - Group standings (if group stage)
     - Win-loss records per team
     - Points/differential
     - Ranking order

2. **Verify Elo ratings**
   - [ ] Admin panel shows team Elo ratings updated
   - [ ] Ratings changed based on match results

#### 7.2 Advance to Next Round
1. **Admin progresses tournament**
   - [ ] Trigger next round creation
   - [ ] Expected:
     - New bracket generated
     - Next round matches scheduled
     - Captains announced
     - Push notification: "Next round scheduled"

#### 7.3 Repeat Match Cycle
1. **Repeat Phases 5–6 for Round 2, Semifinals, Finals**
   - [ ] Follow same flow: betting → matches → results
   - [ ] Vary outcomes to test different bracket scenarios

**Post-Phase 7 State:**
- Tournament progressed to finals
- Multiple rounds of matches completed
- Consistent Elo progression tracked
- Betting system validated across multiple matches

---

## Phase 8: Tournament Completion & Podium

### Test Scenario: Finals, Champion Determination, Podium

#### 8.1 Finals Match
1. **Top 2 teams play final match**
   - [ ] Best of 5 (higher stakes)
   - [ ] Expected:
     - Betting opens for finals
     - Higher viewership (test real-time updates under load)
     - Captain reports final score

2. **Automatic Tournament Completion**
   - [ ] On final match result, tournament auto-completes
   - [ ] Expected:
     - Push notification: "Tournament Complete! [Team Name] wins!"
     - Discord announcement in general channel
     - Season archived

#### 8.2 Verify Podium
1. **Navigate to Podium / Season Archive**
   - [ ] Expected:
     - Champion team displayed prominently
     - Runner-up team shown
     - Full standings / rankings visible
     - Betting payouts finalized

2. **Check Season Record**
   - [ ] Query `seasons` table
   - [ ] Expected:
     - Season record created with summary
     - Champion and runner-up stored
     - Final standings preserved

#### 8.3 Verify Betting Finalization
1. **Parlay bets from finals**
   - [ ] Confirm all parlays settled correctly
   - [ ] Payout = initial amount × product of all odds

**Post-Phase 8 State:**
- Tournament completed
- All bets settled
- Podium/rankings finalized
- Season archived

---

## Phase 9: Player Stats & History

### Test Scenario: Verify Career Stats & Match History

#### 9.1 Player Stats Page
1. **Navigate to `/dashboard/stats`**
   - [ ] Expected:
     - Sortable table of all players
     - Columns: Username, Win Rate, Total Matches, Rating, MVP Count
     - Leaderboard ranked by rating/MVP

#### 9.2 Individual Player Profile
1. **Click on a player**
   - [ ] Expected:
     - Career stats (total wins, match history, series history)
     - Betting history (if visible to self/staff)
     - Team affiliations across seasons

#### 9.3 Match Replay Details
1. **View a completed match**
   - [ ] Expected:
     - Scoreline breakdown (individual game results)
     - Player stats if replays were parsed (goals, assists, saves, etc.)
     - Betting odds that were offered
     - Final payouts for bets on that match

**Post-Phase 9 State:**
- Career stats and history preserved
- Stats consistent across all views

---

## Phase 10: Admin & Moderation Actions

### Test Scenario: Staff Actions During Tournament

#### 10.1 Player Moderation
1. **Kick a player** (soft timeout)
   - [ ] Admin uses Admin panel: Kick Player
   - [ ] Expected:
     - Player receives `Kicked` role
     - Discord timeout applied
     - Player can still see chat but can't participate
     - Cannot bet on remaining matches

2. **Ban a player**
   - [ ] Admin uses Admin panel: Ban Player
   - [ ] Expected:
     - Player status → `banned`
     - All managed roles removed (`Registered`, `Captain`, `Drafted`, team role)
     - Player server-banned (removed from guild)
     - Cannot rejoin without explicit unban

#### 10.2 Dispute Resolution
1. **Escalate a disputed match score**
   - [ ] During a match, captain disputes result
   - [ ] Admin/director reviews and overrides score
   - [ ] Expected:
     - Match updated to correct score
     - Bets recalculated / resolved correctly
     - Players notified of correction

#### 10.3 Manual Match Scheduling
1. **Use `/openround` if needed**
   - [ ] Manually create match channels for a round
   - [ ] Expected: Channels created (if auto-creation failed)

**Post-Phase 10 State:**
- Moderation actions work end-to-end
- Dispute resolution maintains betting integrity

---

## Phase 11: Discord Bot Integration

### Test Scenario: Verify Bot Interactions Throughout

#### 11.1 Bot Commands
1. **Run `/totalplayers`**
   - [ ] Expected: "12 approved players"

2. **Run `/playerinfo [username]`**
   - [ ] Expected: Full stats returned

3. **Run `/diagroles`** (as a player)
   - [ ] Expected: Player's role status shown

4. **Run `/syncroles`** (at any point)
   - [ ] Expected: All roles re-synced, no errors

#### 11.2 Automatic Role Management
1. **Verify role transitions:**
   - [ ] Player joins draft → gets `EnteredDraft` role
   - [ ] Player drafted → gets `Drafted` + team role
   - [ ] Highest RV on team → gets `Captain` role
   - [ ] Player kicked → gets `Kicked` role
   - [ ] Player banned → loses all roles, server-banned

#### 11.3 Push Notifications
1. **Verify notification delivery:**
   - [ ] Signups open → push to all players
   - [ ] Draft starts → push to draft pool
   - [ ] Match scheduled → push to teams
   - [ ] Season ends → push to all
   - [ ] DMs to captains on pick turn

**Post-Phase 11 State:**
- Bot commands all functional
- Role management consistent
- Notifications delivered

---

## Phase 12: Cleanup & Rollback

### Post-Tournament Actions

#### 12.1 Data Verification
- [ ] All 12 players have complete match history
- [ ] All 48 bets (4 teams × players × matches) are settled
- [ ] Coin balances are consistent (sum doesn't change)
- [ ] Team Elo ratings are correct (zero-sum and no math errors)

#### 12.2 Cleanup Options
1. **Keep for demonstration**
   - [ ] Archive tournament
   - [ ] Use as reference for next real tournament

2. **Reset for next test**
   - [ ] Delete tournament, matches, and wagers
   - [ ] Reset player coin balances to starting amount
   - [ ] Keep player accounts

---

## Test Results Checklist

### Phase Completion
- [ ] Phase 0: Setup complete
- [ ] Phase 1: Registration & approval working
- [ ] Phase 2: Tournament signup & creation working
- [ ] Phase 3: Draft or auto-balance working
- [ ] Phase 4: Match scheduling and channels working
- [ ] Phase 5: Betting system end-to-end working
- [ ] Phase 6: Match reporting and wager resolution working
- [ ] Phase 7: Season progression and rankings working
- [ ] Phase 8: Tournament completion and podium working
- [ ] Phase 9: Stats and history preserved
- [ ] Phase 10: Admin/moderation actions working
- [ ] Phase 11: Discord bot integration complete
- [ ] Phase 12: Cleanup and data integrity verified

### Critical Validations
- [ ] No coin balance discrepancies (zero-sum betting)
- [ ] All roles assigned and removed correctly
- [ ] No database constraint violations
- [ ] No runtime errors in logs
- [ ] Push notifications delivered on schedule
- [ ] Discord bot responsive under full load
- [ ] Web UI responsive during match reporting
- [ ] Elo calculations accurate (per new model)

---

## Known Issues & Workarounds

| Issue | Workaround |
|-------|-----------|
| Auto-creation of match channels slow | Use `/openround` to manually create |
| Betting closes before deadline | Refresh page and retry; check server time sync |
| Role assignment delayed | Run `/syncroles` to force sync |
| Coin balance off by 1 | Check for floating-point rounding in DB |

---

## Failure Scenarios & Responses

| Scenario | Action |
|----------|--------|
| Player registration fails | Check Discord OAuth config, check Supabase connectivity |
| Draft doesn't start | Check bot permissions, check draft channel is set |
| Bets don't resolve | Check match status is `completed`, check Elo model |
| Roles not assigned | Run `/syncroles`, check bot role hierarchy |
| Tournament won't complete | Check all matches are reported, no pending matches |

---

## Notes

- **Duration:** 2–4 hours depending on how quickly players complete matches
- **Ideal team size:** 2–3 staff (1 admin, 1 director, 1 observer/logger)
- **Equipment:** Discord server, test database backup, logging/monitoring
- **Concurrent testing:** Can run betting, match results, admin actions in parallel
