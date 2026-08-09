-- The rating a team started the season/tournament at, distinct from the live
-- season_rating that moves with match results. Needed so form retention
-- (crl-final-rating-v1, app/lib/rating.ts) can pull the live rating back
-- toward a fixed anchor instead of toward whatever the roster looks like now.
-- Lazy-initialised the same way season_rating already is, in applySeasonRatingUpdate.
alter table teams add column if not exists initial_rating numeric;
