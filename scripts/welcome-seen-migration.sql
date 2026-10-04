-- Run this in the Supabase SQL editor.
-- Records that an account dismissed the "Get Started" tab. The welcome_seen
-- cookie alone kept coming back: it is per-browser, so a new device, the
-- installed home-screen app (its own cookie jar on iOS), cleared site data, or a
-- browser capping cookie lifetime all brought the tab back.
alter table accounts add column if not exists welcome_seen_at timestamptz;
