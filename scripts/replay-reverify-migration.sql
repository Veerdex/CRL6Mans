-- Adds temporary, per-player identity-field storage to
-- replay_identity_certifications so a flagged replay can be reverified by an
-- admin (after fixing the underlying account/lineup data) without requiring
-- anyone to re-upload the .replay file.
--
-- This is scratch data, not a permanent audit record: it's only populated
-- while a game is uncertified, and is cleared back to null the moment
-- reverification succeeds (or a fresh re-upload supersedes it via the
-- existing upsert). replay_identity_discrepancies.evidence_json remains the
-- permanent audit trail for what was originally flagged and why.
alter table replay_identity_certifications
  add column if not exists player_resolutions_json jsonb;
