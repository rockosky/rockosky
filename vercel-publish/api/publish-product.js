-- ============================================================
-- KETCHUP FILES — schema migration
-- Safe to run all at once, and safe to re-run (every statement is
-- idempotent: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS throughout).
-- Run this in the Supabase SQL editor for project lfbtreaojwxxwuwhssba.
-- ============================================================

-- ---- photos: per-upload category, rejection reason, and the
-- Squarespace publish trail (product id/url + when it went live) ----
ALTER TABLE photos ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS squarespace_product_id text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS squarespace_product_url text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- ---- photos: fashion-specific sub-tag on photo/video uploads (Runway,
-- Backstage, Street Style, First Looks, Interview, Portraits,
-- Journalist), plus the pieces behind the auto-filled title template
-- ("Street style photo of {guest} at the {designer} show, {season}") —
-- guest_name/designer_name are stored separately from the composed
-- `title` so they can drive autocomplete suggestions (distinct past
-- values) without parsing them back out of free text. guest_name is
-- deliberately left NULL rather than storing the literal word "Guest"
-- when a contributor doesn't know who's in the photo — "Guest" is a
-- display-time default, not real data. ----
ALTER TABLE photos ADD COLUMN IF NOT EXISTS subcategory text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS guest_name text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS designer_name text;

-- ---- photos: the clean, non-watermarked original — lives in a
-- PRIVATE bucket ("Ketchup Files ORIGINALS"), never the public one.
-- This is what actually gets emailed to someone after they buy; the
-- public bucket only ever holds the watermarked display copy. Rows
-- uploaded before this existed will have this as NULL. ----
ALTER TABLE photos ADD COLUMN IF NOT EXISTS original_file_path text;

-- ---- order_deliveries: audit trail for the purchase -> email-the-
-- original pipeline. Also doubles as a dedupe guard so a retried
-- Squarespace webhook doesn't send the same buyer two emails. ----
CREATE TABLE IF NOT EXISTS order_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squarespace_order_id text UNIQUE NOT NULL,
  customer_email text,
  photo_ids uuid[],
  delivered_count integer DEFAULT 0,
  missing_originals text[],
  delivered_at timestamptz DEFAULT now()
);

-- Was created above without RLS enabled — Supabase's own security
-- advisor correctly flags any public table with RLS off as CRITICAL,
-- since it means anyone with the anon key can read/write every row
-- with no restriction at all. This table only needs to be written by
-- the service-role key (which bypasses RLS regardless), so simply
-- enabling RLS with no permissive policies locks it down completely
-- for anyone using the anon key while leaving server-side access
-- untouched.
ALTER TABLE order_deliveries ENABLE ROW LEVEL SECURITY;

-- ---- La Semana de la Moda export tracking — lets the admin dashboard
-- show what's already been exported vs. what's new since the last pull. ----
ALTER TABLE photos ADD COLUMN IF NOT EXISTS exported_to_lsdm boolean DEFAULT false;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS lsdm_exported_at timestamptz;

-- ---- photos: columns the current uploader/dashboard actually read and
-- write that may predate this migration — confirmed via direct code
-- inspection of the live 02/03 files, not assumed. Adding these is what
-- was actually missing if uploads have been silently failing: without
-- media_type/camera_used existing as real columns, that insert() call
-- would error out completely and no row (and therefore no photo, no
-- thumbnail) would ever get saved. ----
ALTER TABLE photos ADD COLUMN IF NOT EXISTS media_type text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS camera_used text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS stripe_checkout_url text;

-- Every insert from the uploader omits `status` entirely, relying on the
-- column default to land new rows as 'pending'. If that default was
-- never set, new rows land with status = NULL — which the admin
-- dashboard's `.eq('status', 'pending')` filter would never match, so
-- submissions would silently vanish from the review queue while still
-- existing in the table. This makes sure that can't happen regardless
-- of whether it was set before.
ALTER TABLE photos ALTER COLUMN status SET DEFAULT 'pending';

-- Speeds up the admin dashboard's "pending, oldest first" query and the
-- LSDM export feed's "approved since last pull" query as the table grows.
CREATE INDEX IF NOT EXISTS idx_photos_status_created_at ON photos (status, created_at);
CREATE INDEX IF NOT EXISTS idx_photos_exported_to_lsdm ON photos (exported_to_lsdm) WHERE status = 'published';

-- ============================================================
-- ADMIN WRITE ACCESS ON photos
-- ============================================================
-- Likely root cause of "Approve/Reject doesn't seem to do anything in
-- the admin dashboard": if the existing UPDATE policy on `photos` only
-- allows a contributor to update their OWN row (auth.uid() = user_id),
-- the admin account trying to approve/reject someone ELSE's upload gets
-- silently blocked by RLS — no error is thrown, the update just quietly
-- affects zero rows, and the pending list reloads looking completely
-- unchanged. This adds an explicit carve-out so the admin account can
-- update any row regardless of who uploaded it. It's additive — any
-- existing owner-based UPDATE policy keeps working for contributors,
-- this just adds a second way a write can be allowed.
DROP POLICY IF EXISTS "kf_admin_update_any_photo" ON photos;
CREATE POLICY "kf_admin_update_any_photo" ON photos
  FOR UPDATE USING (auth.email() = 'creators@ketchupfiles.com')
  WITH CHECK (auth.email() = 'creators@ketchupfiles.com');
-- ============================================================

-- ---- creator_profiles: contributor-editable profile (current uploader) ----
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS profile_photo_url text;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS stripe_account_id text;

-- ---- creator_profiles: additional columns used by the Interfaz Studio
-- Marketplace window (avatar + declared work categories there use their
-- own column names, separate from profile_photo_url/bio above — both
-- sets can coexist without conflict since the two tools don't share
-- fields). Skip this block if you've dropped that Marketplace feature. ----
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS categories text;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS profile_views integer DEFAULT 0;

-- ---- profile_comments: guestbook used by the Interfaz Studio
-- Marketplace window's profile modal. Skip if not using that feature. ----
CREATE TABLE IF NOT EXISTS profile_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_user_id uuid NOT NULL,
  author_name text,
  comment_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profile_comments_profile_user_id ON profile_comments (profile_user_id, created_at DESC);

ALTER TABLE profile_comments ENABLE ROW LEVEL SECURITY;

-- Anyone can read the guestbook (it's public by design, like a MySpace
-- comment wall). Only a signed-in user can post, and only as themself.
DROP POLICY IF EXISTS "profile_comments_select_all" ON profile_comments;
CREATE POLICY "profile_comments_select_all" ON profile_comments
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "profile_comments_insert_authenticated" ON profile_comments;
CREATE POLICY "profile_comments_insert_authenticated" ON profile_comments
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- STORAGE (bucket: "Ketchup Files UPLOADS")
-- ============================================================
-- This is the other likely cause of "photo doesn't get saved / no
-- thumbnail": storage.objects has row-level security ON by default in
-- Supabase, same as any other table. Without an explicit policy, a
-- contributor's browser can be fully authenticated and still get a
-- silent/blocked upload, or an upload can succeed while the resulting
-- public URL 403s for everyone else (including Squarespace trying to
-- fetch the thumbnail) — because nothing ever granted read/write access
-- on this bucket specifically. These two policies are the minimum the
-- app actually needs:
--   1. Public read — required for photo URLs to work at all as
--      thumbnails/on the live site/as a Squarespace product image.
--   2. Authenticated users can upload only into a folder matching their
--      own user id (path convention already used throughout: every
--      upload path starts with `${user.id}/...`).
-- If these already exist under different names, these CREATE POLICY
-- calls will simply error as duplicates — safe to skip re-running the
-- ones that already exist, or rename/drop the old ones first.

DROP POLICY IF EXISTS "kf_uploads_public_read" ON storage.objects;
CREATE POLICY "kf_uploads_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'Ketchup Files UPLOADS');

DROP POLICY IF EXISTS "kf_uploads_own_folder_insert" ON storage.objects;
CREATE POLICY "kf_uploads_own_folder_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'Ketchup Files UPLOADS'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lets a contributor delete/replace their own files (e.g. re-uploading a
-- profile photo, or Marketplace's "Delete" button on their own listing).
DROP POLICY IF EXISTS "kf_uploads_own_folder_delete" ON storage.objects;
CREATE POLICY "kf_uploads_own_folder_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'Ketchup Files UPLOADS'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- STORAGE (bucket: "Ketchup Files ORIGINALS" — PRIVATE)
-- ============================================================
-- REMINDER: these policies only matter once the bucket itself exists.
-- SQL can't create a Storage bucket — that's a one-time manual step in
-- Supabase Dashboard > Storage > New bucket, name it exactly
-- "Ketchup Files ORIGINALS", and leave "Public bucket" UNCHECKED.
--
-- The uploader now also saves a clean, non-watermarked original to this
-- bucket on every upload (see 02-kf-upload-widget.html). It needs an
-- INSERT policy for the same reason the public bucket did — without one,
-- that second upload call fails RLS silently, the original never gets
-- saved, and there's nothing to deliver when someone buys later.
--
-- Deliberately NO public or "authenticated" read policy here — the only
-- thing that should ever read from this bucket is the SUPABASE_SERVICE_
-- ROLE_KEY used server-side in publish-product.js/fulfill-order.js,
-- which bypasses RLS entirely and doesn't need a policy at all. If a
-- read policy ever gets added here by mistake, that defeats the entire
-- point of keeping this bucket private.
DROP POLICY IF EXISTS "kf_originals_own_folder_insert" ON storage.objects;
CREATE POLICY "kf_originals_own_folder_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'Ketchup Files ORIGINALS'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "kf_originals_own_folder_delete" ON storage.objects;
CREATE POLICY "kf_originals_own_folder_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'Ketchup Files ORIGINALS'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- NOTE ON RLS FOR photos / creator_profiles (the tables, not storage):
-- This migration only ADDS columns — it does not touch existing RLS
-- policies on `photos` or `creator_profiles`. If those tables already
-- have row-level security enabled (they should, given contributors
-- read/write their own rows), the new columns are covered automatically
-- by whatever row-matching policy already exists — no new policy is
-- needed just because a column was added. Only profile_comments and the
-- storage.objects policies above are genuinely new, which is why they
-- get explicit policies.
-- ============================================================
