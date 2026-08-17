-- ============================================================
-- KETCHUP FILES — cleanup: remove unused columns
-- ============================================================
-- Confirmed direction: Squarespace digital products, not Stripe.
-- And La Semana de la Moda export is disconnected from the UI for now.
-- This removes the columns tied to both, so the schema matches what's
-- actually being used. Safe to run — these were never wired to any
-- active feature, so there's nothing meaningful to lose.
--
-- NOTE: DROP COLUMN permanently deletes any data in that column. If
-- any of these somehow do have real data in them you want to keep,
-- stop and export it first. Given none of these were ever connected
-- to working UI, that's very unlikely to matter here.
-- ============================================================

-- ---- photos: drop unused Stripe fields (Squarespace-only now) ----
ALTER TABLE photos DROP COLUMN IF EXISTS stripe_product_id;
ALTER TABLE photos DROP COLUMN IF EXISTS stripe_price_id;
ALTER TABLE photos DROP COLUMN IF EXISTS stripe_checkout_url;

-- ---- photos: drop LSDM export tracking (disconnected from UI) ----
ALTER TABLE photos DROP COLUMN IF EXISTS exported_to_lsdm;
ALTER TABLE photos DROP COLUMN IF EXISTS lsdm_exported_at;

-- ---- creator_profiles: drop unused Stripe fields ----
ALTER TABLE creator_profiles DROP COLUMN IF EXISTS stripe_account_id;
ALTER TABLE creator_profiles DROP COLUMN IF EXISTS stripe_onboarded;

-- ============================================================
-- The rest of this is a QUESTION, not something already run —
-- payout_ledger is entirely Stripe-payout related (sale splits,
-- Stripe transfer IDs) and nothing currently writes to it. If you
-- want it gone too, uncomment and run this line separately:
--
-- DROP TABLE IF EXISTS payout_ledger;
--
-- Left commented out on purpose since dropping a whole table is a
-- bigger step than dropping a few columns — confirm first.
-- ============================================================
