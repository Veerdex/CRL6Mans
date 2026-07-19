# Test Plan: Registered Role Feature

## Overview
This test plan verifies that the `Registered` Discord role is correctly assigned to approved players, stripped from unapproved players, and managed by the `/syncroles` command.

---

## Setup Phase

### Prerequisites
- [ ] Deploy the new code to a test environment (staging or local dev)
- [ ] Run the migration: `scripts/registered-role-id-migration.sql` in Supabase SQL editor
- [ ] Register the new slash command: `node scripts/register-commands.mjs`
- [ ] Create a Discord role called `Registered` (or use an existing one) in your test server
- [ ] Ensure the bot's role is **above** the `Registered` role in the Discord role hierarchy
- [ ] Have at least 3 test players ready (pending, approved, banned states)

---

## Test Cases

### 1. Initial State (Before `/setregisteredrole`)

**Objective:** Verify the bot falls back to name resolution when no role ID is set.

1. **Approve a pending player** via the web dashboard Admin panel
   - Expected: Player receives the `Registered` role by name
   - If role doesn't exist, bot creates it automatically
   - Player can see the role in their Discord profile

2. **Ban that player** via the Admin panel
   - Expected: `Registered` role is removed (along with other managed roles)
   - Player's roles should reflect "banned" state

3. **Revert the ban** and unapprove them
   - Use SQL or repeat approval flow
   - Expected: Role is re-added on approval, removed on unapproval

---

### 2. Setting the Registered Role ID

**Objective:** Verify `/setregisteredrole` correctly stores the role ID.

1. **Run `/setregisteredrole`** in Discord
   - Option: select the `Registered` role (or any test role)
   - Expected: 
     - Command succeeds with ✅ message
     - Message includes: "Registered role set to <@&ROLE_ID>"
     - Message includes hierarchy warning: "Make sure the bot's own role is **above** it"

2. **Check the database**
   - Query `SELECT registered_role_id FROM league_settings;`
   - Expected: `registered_role_id` column contains the role ID you just set (not null)

---

### 3. Role Assignment on Approval

**Objective:** Verify newly approved players get the configured role.

1. **Have a pending player ready** (use a test account or create one)

2. **Approve them** from the Admin panel
   - Expected:
     - Player status changes to `approved` in DB
     - Player immediately receives the `Registered` role in Discord
     - Role is the one you linked in `/setregisteredrole` (by ID, not by fallback name lookup)

3. **Reject the player**
   - Expected: `Registered` role is removed (if not already, e.g., on ban)

---

### 4. Role Stripping on Ban

**Objective:** Verify banned players lose the `Registered` role.

1. **Approve a test player** (from test case 3)

2. **Ban them** via Admin → Player Actions → Ban
   - Expected:
     - Player status becomes `banned` in DB
     - `Registered` role is immediately stripped from their Discord profile
     - Other managed roles (Drafted, Captain, team) are also stripped

3. **Unban them**
   - Expected: They revert to `banned` state; roles are not automatically re-added (they must re-register)

---

### 5. `/syncroles` Retroactive Application

**Objective:** Verify `/syncroles` applies the role to all approved players retroactively.

1. **Set up test state:**
   - Create 3 test players:
     - Player A: approved, no team
     - Player B: approved, on a team
     - Player C: pending (not approved)
   - Manually remove the `Registered` role from all three in Discord (simulate stale state)

2. **Run `/syncroles` command**
   - Expected:
     - Command succeeds with ✅ message
     - Message includes: "Registered" in the list of managed roles
     - Message shows player counts updated

3. **Verify final state:**
   - Player A: has `Registered` role ✅
   - Player B: has `Registered` role ✅ (plus Drafted/team/Captain if applicable)
   - Player C: does NOT have `Registered` role ✅

---

### 6. `/syncroles` Cleanup (Removing from Unapproved)

**Objective:** Verify `/syncroles` removes the role from players who are not approved.

1. **Manual setup:**
   - Give the `Registered` role to a pending or rejected player in Discord (simulate error state)

2. **Run `/syncroles` command**
   - Expected:
     - The unapproved player's `Registered` role is stripped
     - Approved players retain their roles

---

### 7. Role ID Persistence Across Role Renames

**Objective:** Verify that storing the role ID prevents duplicate role creation on rename.

1. **Set registered role** via `/setregisteredrole` to the `Registered` role

2. **Rename the Discord role** manually (e.g., `Registered` → `Member`)
   - Expected: The bot still references the same role by ID (no duplicate created)

3. **Approve a new player**
   - Expected: 
     - New player gets the role (renamed to `Member`)
     - No new role called `Registered` is created
     - Database still shows the same `registered_role_id`

---

### 8. Integration with Draft Flow

**Objective:** Verify `Registered` role coexists with draft roles.

1. **Approve and draft a player:**
   - Approve player A
   - Add them to the draft pool
   - Assign them to a team during draft

2. **Check Discord roles:**
   - Expected: Player has **all three:**
     - `Registered` (approval status)
     - `Drafted` (active player)
     - `TeamName` (team assignment)
     - Possibly `Captain` (if highest RV)

3. **End the season and move to next draft:**
   - Expected: `/syncroles` is run as part of cleanup
   - Player retains `Registered`, loses `Drafted`/`TeamName`/`Captain`

---

### 9. Edge Cases

#### 9a. Approve/Disapprove Cycle
1. Approve player → has role
2. Reject player → loses role
3. Re-register → goes back to pending
4. Approve again → re-adds role
- Expected: Role management is idempotent

#### 9b. No Role ID Set (Fallback)
1. Clear `registered_role_id` from database (set to NULL)
2. Approve a new player
3. Expected: Bot resolves role by name "Registered", creates if missing

#### 9c. Role Deletion in Discord
1. Manually delete the `Registered` role in Discord
2. Approve a new player or run `/syncroles`
3. Expected: Bot auto-creates the role (if no ID set) OR fails gracefully (if ID set but role missing)

#### 9d. Bot Role Hierarchy Issue
1. Move the bot's role **below** the `Registered` role in Discord
2. Try to approve a player
3. Expected: Role assignment fails silently (logged in bot output)
   - This is expected Discord behavior; warn in command reply

---

## Test Results Checklist

- [ ] Setup phase completed without errors
- [ ] Test 1: Fallback name resolution works
- [ ] Test 2: `/setregisteredrole` command works and stores ID
- [ ] Test 3: Role granted on approval
- [ ] Test 4: Role stripped on ban
- [ ] Test 5: `/syncroles` applies role retroactively to all approved
- [ ] Test 6: `/syncroles` removes role from unapproved
- [ ] Test 7: Role ID prevents duplicates on rename
- [ ] Test 8: Role coexists with draft roles correctly
- [ ] Test 9a: Approve/disapprove cycle is clean
- [ ] Test 9b: Fallback name resolution still works when ID is null
- [ ] Test 9c: Bot handles missing role gracefully
- [ ] Test 9d: Bot role hierarchy issue is logged

---

## Rollback Procedure (If Issues Found)

1. Revert code deployment
2. Unapproved players who got the role by mistake: manually strip via Discord or run `/syncroles` again with old code
3. Delete migration if it caused schema issues: `ALTER TABLE league_settings DROP COLUMN IF EXISTS registered_role_id;`
4. No data loss — the feature is additive

---

## Notes

- **Time estimate:** 30–45 minutes with real test players
- **Best tested with:** 2–3 actual player accounts + admin account
- **Common gotchas:**
  - Bot role hierarchy — ensure bot role is at the top
  - Role ID vs. role name — the stored ID is the single source of truth
  - Migration not applied — command will silently fail if column doesn't exist
