-- ============================================================
-- KETCHUP FILES — public read access for approved/published photos
-- ============================================================
-- The gallery/community queries (SELECT * FROM photos WHERE status IN
-- ('approved','published'), no user_id filter) are correct — they're
-- meant to show everyone's approved work, not just your own. If you're
-- not seeing other contributors' uploads, this is the most likely
-- cause: Row Level Security on `photos` may only have a policy letting
-- someone read their OWN rows (auth.uid() = user_id), with no broader
-- policy for "approved/published rows are public." This adds that
-- explicitly. Safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS "kf_photos_public_read_approved" ON photos;
CREATE POLICY "kf_photos_public_read_approved" ON photos
  FOR SELECT USING (status IN ('approved', 'published'));

-- Also make sure a contributor can always read their OWN rows regardless
-- of status (pending/rejected included) — needed for "My Uploads" to
-- show everything they've submitted, not just what's gone live.
DROP POLICY IF EXISTS "kf_photos_read_own" ON photos;
CREATE POLICY "kf_photos_read_own" ON photos
  FOR SELECT USING (auth.uid() = user_id);
