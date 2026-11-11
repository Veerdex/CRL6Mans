# Keeping cron off Vercel's CPU

How the per-minute cron work was moved behind database checks so Vercel only runs when there is something to do. Done 2026-11-10/11.

## The problem

Vercel bills Fluid compute as **Active CPU** (time our code is actually executing) plus provisioned memory and invocations. A cron route costs that even when it finds nothing to do: a cold start, a session of Supabase reads, and a return. The usage page showed one `clip-reset` run at about **430 ms**, almost all of it startup and the empty checks.

Three routes need to react within a minute of something becoming due:

| Route | What it reacts to |
|---|---|
| `/api/cron/tournament-scheduler` | score auto-confirm, sign-ups open/close, activation, team formation, bracket pre-generation, season start, check-in windows and forfeits, match channels, weekly coins, 24h reminder, prediction freezing |
| `/api/cron/draft-autopick` | an expired pick timer, league draft or fantasy draft |
| `/api/cron/clip-reset` | clip expiry, the 4 AM waiver run, Sunday Clip of the Week, fantasy trade reviews and reminders, fantasy notices |

The plan was an external pinger (cron-job.org) hitting all three every minute. That is 4,320 Vercel invocations a day, nearly all of which do nothing. It also turned out not to be working: the heartbeat columns only ever showed the daily `vercel.json` runs, so per-minute work was really waiting for midnight or for someone to trigger it from the site.

## The approach: ask the database first

The question "is anything due?" is a few indexed reads, so it is answered **inside Supabase** with `pg_cron`, which costs no Vercel CPU. Vercel is called only when the answer is yes.

```
every minute (pg_cron, in Postgres)
  crl_cron.tick(job)
    ├─ a previous wake still running?        → stop
    ├─ crl_cron.due(job): anything due?      → no: stop (no Vercel call)
    └─ yes: net.http_get(route, Bearer secret), log the wake
```

Supabase is a fixed-size instance with no per-query billing, so running these checks every minute costs nothing extra. The scheduler check measured about 11 ms.

## The pieces

All of it lives in the `crl_cron` schema, which is not exposed through the API (`anon`/`authenticated` have no access). The SQL is in `scripts/cron-gated-wakes-migration.sql`.

- **`crl_cron.wakes`**: one row per Vercel call: `job`, `reasons[]`, the pg_net `request_id`, `woken_at`. It is the audit trail, the in-flight guard and the retry clock.
- **`scheduler_due()` / `autopick_due()` / `clipreset_due()`**: each returns `(reason, due_at)`, one row per thing its route would act on right now. Each condition **mirrors the route's own code**, so the route is only woken when it will actually do something. `due_at` is when the row became due, or null for conditions with no timestamp.
- **`retry_after(reason)`**: how long a reason that is *still* due after a wake waits before waking again.
- **`tick(job)`**: the gate (below). The bearer token is read from Vault (`crl6mans_cron_secret`, the same value as Vercel's `CRON_SECRET`) at call time, so it never appears in a job definition. Timeouts match each route's `maxDuration`: 300 s, or 60 s for autopick.
- **pg_cron jobs** `crl6mans-scheduler`, `crl6mans-autopick` and `crl6mans-clipreset` (every minute) and `crl6mans-cron-cleanup` (03:17 daily). The cleanup trims only these jobs' own `cron.job_run_details` (3 days) and old wake rows (60 days). pg_net expires its own responses after 6 hours. The queue bot's pg_cron jobs are untouched.

## The gate rules

A reason wakes Vercel when either:

1. **Something new is due.** A row's `due_at` is later than the last wake for that reason, so it fires within a minute.
2. **Something is still due after the retry interval.** The route was woken but couldn't clear it (a failed Discord call, a trade held because a player is mid-match). It is retried after `retry_after`: 10 minutes by default, 1 hour for `trade_review` and `fantasy_sweep`, 4 hours for `trade_reminder` (effectively once).

Rule 2 is what stops a condition the route can never clear from waking Vercel every minute forever. At worst it costs a wake every 10 minutes, and the wake log shows it.

A wake is also skipped while the previous one for the same job is still running (no response row yet and inside its timeout), so a long draft start can't overlap itself.

Conditions that are not time-critical are deliberately left out:
- tournament matches without a check-in deadline and bracket-reset matches (the report path opens those itself);
- round 1 of a manual season (the admin's Start Round does it).

## What it costs now

- **No event running:** scheduler and autopick make **zero** Vercel calls.
- **Clip-reset** wakes once an hour while a fantasy league is active (`fantasy_sweep`: weekly results, playoff seeding and lineup alerts have no single due moment), and otherwise only for real events.
- **Replay cleanup** keeps its 6-hour cadence (`replay_cleanup`): about 4 calls a day.
- **During an event**, calls track the work: roughly one per score confirmation, check-in window, deadline, timed-out pick and so on.

The daily `vercel.json` crons stay as a **backstop** if Supabase ever misses. `patreon-sync` and `discord-sync` were always daily-only and are unchanged.

## Checking on it

```sql
-- Vercel calls per job per day, and why
select job, woken_at::date as day, count(*), array_agg(distinct r) as reasons
from crl_cron.wakes, unnest(reasons) r
group by 1, 2 order by 2 desc, 1;

-- Did the calls succeed? (responses are kept 6 hours)
select w.job, w.reasons, w.woken_at, r.status_code, r.timed_out, r.error_msg
from crl_cron.wakes w left join net._http_response r on r.id = w.request_id
order by w.woken_at desc limit 20;

-- What would wake right now
select * from crl_cron.due('scheduler');

-- Pause or resume one job
select cron.alter_job((select jobid from cron.job where jobname = 'crl6mans-clipreset'), active := false);
```

Compare the wake counts with the Vercel usage page to confirm the saving.

## Keeping it correct

- **A new time-sensitive branch in one of the three routes needs a matching row in its `*_due()` function.** Otherwise it only runs when something else wakes the route, or at the daily backstop. Copy the route's own condition, give it a `due_at`, and add a `retry_after` case if it can't always be cleared.
- Rotating `CRON_SECRET` means updating the Vault secret `crl6mans_cron_secret` to match. Otherwise every wake returns 401.
- The routes still stamp their heartbeat columns, but those now update only when a route is woken. A quiet heartbeat means "nothing was due", not "the pinger is down". The wake log is the better health signal.
- No external pinger is needed. Any cron-job.org jobs hitting these routes should be disabled, or they bypass the gate.
