

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
