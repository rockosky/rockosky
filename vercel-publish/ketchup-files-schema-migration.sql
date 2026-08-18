

ALTER TABLE photos ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS squarespace_product_id text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS squarespace_product_url text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS published_at timestamptz;


ALTER TABLE photos ADD COLUMN IF NOT EXISTS subcategory text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS guest_name text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS designer_name text;


ALTER TABLE photos ADD COLUMN IF NOT EXISTS original_file_path text;


CREATE TABLE IF NOT EXISTS order_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squarespace_order_id text UNIQUE NOT NULL,
  customer_email text,
  photo_ids uuid[],
  delivered_count integer DEFAULT 0,
  missing_originals text[],
  delivered_at timestamptz DEFAULT now()
);


ALTER TABLE order_deliveries ENABLE ROW LEVEL SECURITY;

-- ---- La Semana de la Moda export tracking — lets the admin dashboard
-- show what's already been exported vs. what's new since the last pull. ----
ALTER TABLE photos ADD COLUMN IF NOT EXISTS exported_to_lsdm boolean DEFAULT false;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS lsdm_exported_at timestamptz;

ALTER TABLE photos ADD COLUMN IF NOT EXISTS media_type text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS camera_used text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS stripe_checkout_url text;

ALTER TABLE photos ALTER COLUMN status SET DEFAULT 'pending';

-- Speeds up the admin dashboard's "pending, oldest first" query and the
-- LSDM export feed's "approved since last pull" query as the table grows.
CREATE INDEX IF NOT EXISTS idx_photos_status_created_at ON photos (status, created_at);
CREATE INDEX IF NOT EXISTS idx_photos_exported_to_lsdm ON photos (exported_to_lsdm) WHERE status = 'published';


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
