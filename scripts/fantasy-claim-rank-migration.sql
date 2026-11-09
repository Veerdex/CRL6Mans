-- ─────────────────────────────────────────────────────────────────────────────
-- FANTASY — claim preference (docs/fantasy-rl.md §9). Additive only.
--
-- fantasy_waiver_claims.rank  the manager's preference among their pending
--                             claims, 1 most wanted. The run settles claims in
--                             rounds of the waiver order and gives each manager
--                             their best-ranked claim that still works. Null on
--                             claims filed before this column: those sort after
--                             ranked ones, by filing time.
-- ─────────────────────────────────────────────────────────────────────────────

alter table fantasy_waiver_claims add column if not exists rank integer;
