-- Betting latch: the first time a result is reported for a match, stamp it here
-- and never clear it. pending_home_score / score_submitted_at both go back to
-- null when a captain retracts a submission (cancelSeriesSubmission) or an admin
-- rejects a replay, which would otherwise re-open betting on a match whose score
-- has already been announced in the Discord match channel.
--
-- score_submitted_at cannot serve as the latch: processExpiredScoreConfirmations
-- in app/lib/discord-bot.ts uses it as the auto-finalize cutoff, so leaving it set
-- after a retraction would auto-finalize the retracted score.

alter table matches add column if not exists result_reported_at timestamptz;
