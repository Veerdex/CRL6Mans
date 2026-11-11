-- Gated pg_cron wakes for the per-minute cron routes. See docs/cron-cpu.md.
-- Applied to production 2026-11-11. Needs the Vault secret crl6mans_cron_secret
-- (same value as Vercel's CRON_SECRET) to exist first.

-- ── Step 1: objects (no schedules yet) ──────────────────────────────────────
create schema crl_cron;
revoke all on schema crl_cron from public, anon, authenticated;

create table crl_cron.wakes (
  id         bigserial primary key,
  job        text not null,
  reasons    text[] not null,
  request_id bigint,
  woken_at   timestamptz not null default now()
);
create index wakes_job_woken_at on crl_cron.wakes (job, woken_at desc);

-- Most recent 4 AM America/Los_Angeles (latestWaiverRun).
create function crl_cron.waiver_boundary() returns timestamptz language sql stable as $$
  select (case when b <= l then b else b - interval '1 day' end) at time zone 'America/Los_Angeles'
  from (select now() at time zone 'America/Los_Angeles' as l) x,
       lateral (select date_trunc('day', x.l) + interval '4 hours' as b) y
$$;

-- Most recent Sunday 00:00 America/Los_Angeles (mostRecentSundayMidnightPacific).
create function crl_cron.week_boundary() returns timestamptz language sql stable as $$
  select (date_trunc('week', (now() at time zone 'America/Los_Angeles') + interval '1 day') - interval '1 day')
         at time zone 'America/Los_Angeles'
$$;

-- Each row is something the route would act on right now, with the moment it
-- became due (null = no timestamp; only the retry interval can wake it).
create function crl_cron.scheduler_due() returns table (reason text, due_at timestamptz)
language sql stable as $$
  with ls as (select * from public.league_settings limit 1),
       t  as (select t.* from public.tournaments t join ls on t.id = ls.active_tournament_id)
  select 'score_confirm', m.score_submitted_at + case when ls.active_tournament_id is not null
                                                      then interval '5 minutes' else interval '15 minutes' end
    from public.matches m, ls
   where m.pending_home_score is not null and m.home_score is null and m.score_confirmed = false
     and m.score_submitted_at is not null
     and m.score_submitted_at + case when ls.active_tournament_id is not null
                                     then interval '5 minutes' else interval '15 minutes' end <= now()
  union all
  select 'freeze_predictions', null::timestamptz
    from public.matches m
   where m.home_team_id is not null and m.away_team_id is not null
     and ((m.betting_mode is null and coalesce(m.schedule_accepted, false))
       or (m.status is distinct from 'completed'
           and (m.predicted_home_win_prob is null or m.predicted_away_win_prob is null)))
  union all
  select 'signups_open', s.draft_open_at
    from public.tournaments s
   where s.status = 'scheduled' and not coalesce(s.signups_open, false) and not coalesce(s.signups_closed, false)
     and s.draft_open_at <= now() and (s.draft_close_at is null or s.draft_close_at > now())
  union all
  select 'signups_close', s.draft_close_at
    from public.tournaments s
   where s.status = 'scheduled' and coalesce(s.signups_open, false) and s.draft_close_at <= now()
  union all
  select 'activate', case when s.join_mode = 'players' then s.draft_start_at else s.draft_close_at end
    from public.tournaments s, ls
   where s.status = 'scheduled' and ls.active_tournament_id is null
     and not coalesce(ls.draft_active, false) and not coalesce(ls.season_active, false)
     and case when s.join_mode = 'players' then s.draft_start_at else s.draft_close_at end <= now()
  union all
  select 'weekly_coins', ls.last_coin_grant_at + interval '7 days'
    from ls
   where coalesce(ls.season_active, false) and ls.active_tournament_id is null
     and not coalesce(ls.is_test_season, false)
     and (ls.last_coin_grant_at is null or ls.last_coin_grant_at + interval '7 days' <= now())
  union all
  select 'replay_cleanup', coalesce(ls.last_platform_replay_cleanup_at, '-infinity') + interval '6 hours'
    from ls
   where coalesce(ls.last_platform_replay_cleanup_at, '-infinity') + interval '6 hours' <= now()
  union all
  select 'reminder_24h', s.season_start_at - interval '24 hours'
    from public.tournaments s
   where s.status in ('scheduled', 'active') and s.reminder_24h_sent_at is null
     and s.season_start_at > now() and s.season_start_at <= now() + interval '24 hours'
  union all
  select 'form_teams', case when t.join_mode = 'teams' then t.draft_close_at else t.draft_start_at end
    from t, ls
   where t.teams_formed_at is null and not coalesce(ls.season_active, false)
     and ((t.join_mode = 'teams' and t.draft_close_at <= now()
           and not exists (select 1 from public.players p where p.team_id is not null))
       or (t.join_mode is distinct from 'teams' and t.draft_start_at <= now()
           and not coalesce(ls.draft_active, false)))
  union all
  select 'bracket_pregen',
         greatest(t.season_start_at - interval '30 minutes',
                  case when t.join_mode = 'teams' then t.draft_close_at else t.draft_start_at end)
    from t, ls
   where t.season_start_at is not null and t.bracket_generated_at is null
     and not coalesce(ls.season_active, false) and not coalesce(ls.draft_active, false)
     and coalesce(case when t.join_mode = 'teams' then t.draft_close_at else t.draft_start_at end, '-infinity') <= now()
     and t.season_start_at - interval '30 minutes' <= now()
  union all
  select 'season_start', t.season_start_at
    from t, ls
   where t.season_start_at <= now()
     and not coalesce(ls.season_active, false) and not coalesce(ls.draft_active, false)
  union all
  -- Tournament check-in: the window opening (notify) and the deadline (forfeit).
  select case when m.checkin_deadline > now() then 'checkin_open' else 'checkin_forfeit' end,
         case when m.checkin_deadline > now() then m.checkin_deadline - interval '10 minutes'
              else m.checkin_deadline end
    from public.matches m, ls
   where coalesce(ls.season_active, false) and ls.active_tournament_id is not null
     and m.status = 'scheduled' and m.checkin_deadline is not null
     and m.home_team_id is not null and m.away_team_id is not null
     and not (m.stage = 'de_grand_final' and m.match_number = 2)
     and not (coalesce(m.home_checked_in, false) and coalesce(m.away_checked_in, false))
     and (m.checkin_deadline <= now()
       or (m.checkin_deadline - interval '10 minutes' <= now() and not coalesce(m.checkin_notified, false)))
  union all
  -- Tournament channels open with the check-in window.
  select 'open_channel', m.checkin_deadline - interval '10 minutes'
    from public.matches m, ls
   where coalesce(ls.season_active, false) and ls.active_tournament_id is not null
     and m.status = 'scheduled' and m.discord_channel_id is null
     and m.home_team_id is not null and m.away_team_id is not null
     and m.checkin_deadline - interval '10 minutes' <= now()
  union all
  -- Manual season: a round's channels open once the previous round's deadline passes.
  select 'open_round', prev.deadline_at
    from public.matches m
    join ls on coalesce(ls.season_active, false) and ls.active_tournament_id is null
    join public.round_schedules prev
      on prev.tournament_id is null and prev.round = m.round - 1
     and prev.stage = case when starts_with(m.stage, 'group_') then 'group' else m.stage end
   where m.status = 'scheduled' and m.discord_channel_id is null
     and m.home_team_id is not null and m.away_team_id is not null
     and m.round > 1 and prev.deadline_at <= now()
     and exists (select 1 from public.round_schedules cur
                  where cur.tournament_id is null and cur.stage = prev.stage and cur.round = m.round)
     and not exists (select 1 from public.matches x
                      where x.stage = m.stage and x.round < m.round and x.status = 'scheduled'
                        and (x.home_team_id in (m.home_team_id, m.away_team_id)
                          or x.away_team_id in (m.home_team_id, m.away_team_id)))
$$;

create function crl_cron.autopick_due() returns table (reason text, due_at timestamptz)
language sql stable as $$
  select 'draft_pick', ls.pick_deadline from public.league_settings ls where ls.pick_deadline <= now()
  union all
  select 'fantasy_pick', f.pick_deadline from public.fantasy_leagues f
   where f.status = 'drafting' and f.pick_deadline <= now()
$$;

create function crl_cron.clipreset_due() returns table (reason text, due_at timestamptz)
language sql stable as $$
  select 'clip_expiry', c.expires_at from public.clips c
   where c.archived_at is null and c.expires_at <= now()
  union all
  select 'waivers', crl_cron.waiver_boundary() from public.fantasy_leagues f
   where f.status = 'active' and (f.waivers_ran_at is null or f.waivers_ran_at < crl_cron.waiver_boundary())
  union all
  select 'clip_of_week', crl_cron.week_boundary() from public.league_settings ls
   where ls.last_clip_reset_at is null or ls.last_clip_reset_at < crl_cron.week_boundary()
  union all
  select 'trade_review', tr.review_ends_at from public.fantasy_trades tr
   where tr.status = 'review' and tr.review_ends_at <= now()
  union all
  select 'trade_reminder', tr.review_ends_at - interval '4 hours' from public.fantasy_trades tr
   where tr.status = 'review' and tr.review_ends_at - interval '4 hours' <= now() and tr.review_ends_at > now()
  union all
  select 'fantasy_sweep', null::timestamptz
   where exists (select 1 from public.fantasy_leagues f where f.status = 'active')
$$;

-- How long a reason that is still due after a wake waits before waking again.
create function crl_cron.retry_after(p_reason text) returns interval language sql immutable as $$
  select case p_reason
    when 'trade_review'   then interval '1 hour'   -- a trade held by a player mid-match
    when 'fantasy_sweep'  then interval '1 hour'   -- results, seeding, lineup alerts
    when 'trade_reminder' then interval '4 hours'  -- once per trade; the sent log dedupes
    else interval '10 minutes'
  end
$$;

create function crl_cron.due(p_job text) returns table (reason text, due_at timestamptz)
language plpgsql stable as $$
begin
  case p_job
    when 'scheduler' then return query select * from crl_cron.scheduler_due();
    when 'autopick'  then return query select * from crl_cron.autopick_due();
    when 'clipreset' then return query select * from crl_cron.clipreset_due();
  end case;
end $$;

-- Wakes the route only when something is due. A reason wakes immediately when a
-- row became due after its last wake, and otherwise only once retry_after has
-- passed, so a condition the route can't clear costs a wake every 10 minutes at
-- most rather than every minute. A wake still in flight blocks the next.
create function crl_cron.tick(p_job text) returns void language plpgsql as $$
declare
  v_path    text := case p_job when 'scheduler' then '/api/cron/tournament-scheduler'
                               when 'autopick'  then '/api/cron/draft-autopick'
                               when 'clipreset' then '/api/cron/clip-reset' end;
  v_timeout int  := case p_job when 'autopick' then 60000 else 300000 end;
  v_reasons text[];
  v_request bigint;
begin
  if exists (
    select 1 from crl_cron.wakes w
     where w.job = p_job and w.woken_at > now() - v_timeout * interval '1 millisecond'
       and not exists (select 1 from net._http_response r where r.id = w.request_id)
  ) then
    return;
  end if;

  select array_agg(d.reason order by d.reason) into v_reasons
    from (select x.reason, max(x.due_at) as newest from crl_cron.due(p_job) x group by x.reason) d
    left join lateral (select max(w.woken_at) as last from crl_cron.wakes w
                        where w.job = p_job and d.reason = any (w.reasons)) l on true
   where l.last is null or d.newest > l.last or l.last < now() - crl_cron.retry_after(d.reason);

  if v_reasons is null then
    return;
  end if;

  select net.http_get(
           url := 'https://www.crlwest6mans.com' || v_path,
           headers := jsonb_build_object('Authorization', 'Bearer ' ||
             (select decrypted_secret from vault.decrypted_secrets where name = 'crl6mans_cron_secret')),
           timeout_milliseconds := v_timeout)
    into v_request;

  insert into crl_cron.wakes (job, reasons, request_id) values (p_job, v_reasons, v_request);
end $$;

revoke all on all functions in schema crl_cron from public, anon, authenticated;
revoke all on all tables in schema crl_cron from public, anon, authenticated;

-- ── Step 2 (after a dry run of crl_cron.due() for each job): schedules ──────
-- Applied as jobids 10–13.
select cron.schedule('crl6mans-scheduler', '* * * * *', $$select crl_cron.tick('scheduler')$$);
select cron.schedule('crl6mans-autopick',  '* * * * *', $$select crl_cron.tick('autopick')$$);
select cron.schedule('crl6mans-clipreset', '* * * * *', $$select crl_cron.tick('clipreset')$$);
select cron.schedule('crl6mans-cron-cleanup', '17 3 * * *', $$
  delete from cron.job_run_details
   where end_time < now() - interval '3 days'
     and jobid in (select jobid from cron.job where jobname like 'crl6mans-%');
  delete from crl_cron.wakes where woken_at < now() - interval '60 days';
$$);
