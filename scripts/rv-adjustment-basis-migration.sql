-- The MMR rating a seeded RV adjustment was measured against. Held while a
-- player has no MMR on file, so their first join confirmation can damp the
-- adjustment by how far their ranks have risen since (adjustmentAfterMmrEdit).
-- Cleared by whichever write first puts MMR on file.
alter table seeded_rv_adjustments add column if not exists rv_adjustment_basis double precision;
alter table players add column if not exists rv_adjustment_basis double precision;
