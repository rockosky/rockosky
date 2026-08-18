

DROP POLICY IF EXISTS "kf_photos_public_read_approved" ON photos;
CREATE POLICY "kf_photos_public_read_approved" ON photos
  FOR SELECT USING (status IN ('approved', 'published'));

-- Also make sure a contributor can always read their OWN rows regardless
-- of status (pending/rejected included) — needed for "My Uploads" to
-- show everything they've submitted, not just what's gone live.
DROP POLICY IF EXISTS "kf_photos_read_own" ON photos;
CREATE POLICY "kf_photos_read_own" ON photos
  FOR SELECT USING (auth.uid() = user_id);
