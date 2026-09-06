# Moving the bot from the test server to the official server

This is the runbook for pointing the live site at a different Discord server. It
assumes the **same Discord application** (same bot, same token, same client ID) —
"transferring the bot" normally means inviting the app you already have into a
new guild. See [If you are also creating a new Discord application](#if-you-are-also-creating-a-new-discord-application)
at the bottom if that is not the case.

Permissions, scopes, and role hierarchy are not repeated here — they are in
[README.md → Required Discord permissions](README.md#required-discord-permissions).

**Read first:**

- `/admin disconnect` **deletes every team slot** (name, logo, and `discord_role_id`).
  That is deliberate — a role ID only means something in the guild it came from —
  but it means the slots have to be rebuilt by hand afterwards. Screenshot the
  **Admin → Team Slots** panel before you start if you want the names and logos back.
- Deleting the teams also **deletes every sub request** (`sub_requests.team_id`
  cascades). Match results, player rows, stats, and clips are keyed elsewhere and
  survive; the sub-request history does not.
- `/admin disconnect` and `/admin wipe` are different commands. Disconnect clears the
  Discord *connection*. Wipe clears *game and season data* and keeps the connection.
  You want disconnect. Do not run wipe.
- Do this while **no draft is running and no matches are scheduled**. There is a
  window in the middle where the site is pointed at the new guild but still holds
  old-guild channel and role IDs; anything automatic in that window (match channel
  creation, role assignment, cron) fails silently with a Discord 403.

---

## Step 1 — Run the foreign-key fix (do this before anything else)

In the Supabase SQL editor, run [`scripts/score-submitted-fk-fix.sql`](scripts/score-submitted-fk-fix.sql).

`/admin disconnect` deletes every row in `teams`. If `matches.score_submitted_by_team_id`
still points at teams without `on delete set null`, that delete is rejected the moment
any match carries a captain-submitted score, and disconnect fails outright.

The script is a no-op if the constraint is already correct, so run it regardless of
whether you think it has been run before.

This is the only foreign key into `teams` that is missing an on-delete rule — every
other one (`players.team_id`, the four team columns on `matches`,
`league_settings.current_bid_team_id`, the match identity snapshots) already sets null,
and `sub_requests.team_id` already cascades. So this one script is the whole
prerequisite; there is nothing else to patch first.

## Step 2 — Invite the app to the official server

- Invite with scopes **`bot`** + **`applications.commands`** and the permissions in the
  README table.
- In **Server Settings → Roles**, drag the bot's role to the **top**. Every team role,
  `Registered`, `Captain`, `Drafted`, and `Kicked` must sit below it, and it must sit
  above anyone the bot needs to time out or ban.
- Leave the test server alone for now. Disconnect makes no Discord API calls, so
  nothing in the test server is deleted or changed by any of this — you can keep it
  as a fallback and clean it up later.

## Step 3 — Get a permanent invite link for the official server

Create a **never-expiring** invite to the official server and keep it handy — Step 5
needs it, and Step 8 depends on it.

## Step 4 — Update the environment variables

Update these in **two** places — **Vercel → Settings → Environment Variables**
(Production, and any Preview scope you use) **and** your local `.env.local`. The
`.env.local` copy is not just for local dev: Step 5 runs on your machine and reads
`DISCORD_GUILD_ID` from that file, not from Vercel.

| Variable | New value |
|---|---|
| `DISCORD_GUILD_ID` | the official server's guild ID |
| `DISCORD_INVITE_URL` | the invite from Step 3 |
| `NEXT_PUBLIC_DISCORD_INVITE_URL` | the same invite (both must be set) |

`DISCORD_GUILD_ID` is the single switch — every guild REST call the app makes reads it.

**Do not change** `DISCORD_REDIRECT_URI` (it is tied to your domain, not the server),
`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`/`SECRET`, `DISCORD_PUBLIC_KEY`, or
`ADMIN_DISCORD_IDS` (those are global Discord user IDs and work in any server).

**Redeploy** after saving. Env changes do not take effect on the running deployment.

## Step 5 — Re-register the slash commands

```bash
node scripts/register-commands.mjs
```

This reads `DISCORD_GUILD_ID` from **`.env.local`**, not from Vercel. If you only
updated Vercel in Step 4, this silently re-registers the commands to the *test* server
again and the official server gets nothing — which then leaves you with no
`/admin disconnect` to run in Step 6. Check `.env.local` before running it.

Commands are registered **per guild** when `DISCORD_GUILD_ID` is set, so the official
server has none until you re-run this with the new ID in place. The test server's
copies stay behind harmlessly; they will point at the same site, so remove the bot
from the test server when you are done if you don't want people using them.

## Step 6 — Disconnect the old server

In the **official** server, as CEO:

```
/admin disconnect confirm:CONFIRM DISCONNECT
```

Type the confirmation string exactly. This clears, in the database only:

- all channel IDs (rules, announcement, draft, clips, match category + anchor)
- all role IDs (moderator, director, CEO, registered, supporter)
- every team slot
- every match's stored Discord channel ID
- every match category and every supporter-tier → role link

It does **not** touch `staff_roles` or player Discord IDs — those are global user IDs,
so your staff list and every registered player survive the move untouched.

If it reports "Disconnect incomplete — N of 5 step(s) failed", fix the reported error
and re-run it. Do not continue past a partial disconnect; stale IDs from the old guild
are exactly what this step exists to remove.

## Step 7 — Reconfigure the official server

Run `/admin checklist` (Director or above) and work the list it gives you. All of these
are subcommands of `/admin`:

- `/admin setruleschannel` — run **inside** the rules channel
- `/admin setannouncement` — run **inside** the announcement channel
- `/admin setdraftchannel` — run **inside** the draft channel
- `/admin setclipschannel` — run **inside** the clips channel
- `/admin setmatchcategoryanchor` — sets where match categories get created
- `/admin setmoderatorid`, `/admin setdirectorid`, `/admin setceoid` — staff ping roles
- `/admin setregisteredrole` — create the `Registered` role first, then link it
- `/admin setsupporterrole role:@<role> tier:<n>` — once per paid Patreon tier

Then, in the website's **Admin → Team Slots** panel:

- recreate each team slot (name, logo)
- create one Discord role per team in the official server, and paste each role's ID
  into its slot — slots show "⚠ no role ID set" until linked
- make sure every team role sits **below** the bot's role

Finally:

```
/admin syncroles sync_registered:true
```

which reconciles every player's roles against the database in the new server.

Run it here to seed the roles, then **run it again at the end of Step 8**. Right now
almost nobody has joined the official server yet, and Discord cannot give a role to
someone who is not a member — so this first pass will skip most of the roster. The
second pass, after people have crossed over, is the one that actually lands the roles.

> README.md's Part 2 setup checklist writes some of these without the `admin` prefix
> (`/setmoderatorid` etc.). That form is stale — the `/admin ` prefix above is correct.

## Step 8 — Get the players into the new server

**This is the step that actually bites.** The site checks Discord membership before it
lets anyone register, enter a draft, or join a tournament. Every approved player is a
member of the *test* server; the moment `DISCORD_GUILD_ID` flips, none of them are
members of the one the site is checking. They get:

> You must join the Discord server before registering. Join here: &lt;invite&gt;

and drafts/tournament signups are blocked for them.

So: post the Step 3 invite everywhere the players will see it, and make sure both
invite env vars are set so that prompt links somewhere real.

To measure how many have crossed over:

```bash
node scripts/export-player-names.mjs
```

Its summary line reads `in guild <id>: N of M` — chase the gap until N reaches M. (It
also writes `player-names.csv`, which is gitignored; the row count spans everyone the
site knows about, not only approved players.)

Once the roster has crossed over, run `/admin syncroles sync_registered:true` again —
the Step 7 pass could not give roles to people who were not members yet.

## Step 9 — Verify

- `/admin checklist` → "✅ Nothing missing — the server looks fully configured."
- Approve one registration from the admin page and confirm the `Registered` role lands
  on that member in the official server.
- Have one player enter the draft and confirm they are not blocked by the membership
  check.
- Create a test match and confirm its private channel appears under the right category,
  then record the result and confirm the channel is deleted.

---

## If you are also creating a new Discord application

Only if the official server needs its own bot user, not the existing one. Everything
above still applies; additionally:

- Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_PUBLIC_KEY`, and
  `DISCORD_BOT_TOKEN` to the new application's values.
- Add the OAuth2 redirect URL (`https://<your-domain>/api/auth/discord/callback`) to
  the new application, matching `DISCORD_REDIRECT_URI` exactly.
- Set the new application's **Interactions Endpoint URL** to
  `https://<your-domain>/api/discord/interactions`. Discord validates it immediately —
  the app must be deployed with the new `DISCORD_PUBLIC_KEY` before it will accept it.
- Everyone's existing login sessions were issued against the old client ID; expect
  players to re-authorize on next login.
