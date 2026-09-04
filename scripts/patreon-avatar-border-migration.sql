-- Avatar Border benefit (avatar-border).
--
-- Stores the chosen border's catalog id (see app/lib/avatar-borders.ts), not a
-- path or any geometry: the opening coordinates each frame is fitted to are art
-- facts that ship with the image, and putting them in the database would mean a
-- re-export could not correct them without a data migration. An id that is no
-- longer in the catalog resolves to no border rather than a broken image.
--
-- Read by the dashboard layout on every page render, so apply this before
-- deploying: a missing column makes the whole select fail, which also silently
-- drops the supporter badge and every name colour.

alter table accounts add column if not exists patreon_avatar_border text;
