-- ============================================================
-- KETCHUP FILES — community chat
-- ============================================================
-- One shared room where any logged-in contributor/creator can talk to
-- each other, live. Uses the display name (never email) already
-- established across the rest of the app.
-- ============================================================

CREATE TABLE IF NOT EXISTS community_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  author_name text NOT NULL,
  message_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_messages_created_at ON community_messages (created_at DESC);

ALTER TABLE community_messages ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can read the whole room (it's a public shared space,
-- not private DMs).
DROP POLICY IF EXISTS "kf_chat_read_authenticated" ON community_messages;
CREATE POLICY "kf_chat_read_authenticated" ON community_messages
  FOR SELECT USING (auth.role() = 'authenticated');

-- Can only ever post as yourself.
DROP POLICY IF EXISTS "kf_chat_insert_own" ON community_messages;
CREATE POLICY "kf_chat_insert_own" ON community_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Make sure Realtime is actually broadcasting changes on this table —
-- without this, new messages would only show up on manual refresh.
-- Wrapped so re-running this script doesn't error if it's already added.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE community_messages;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already added, nothing to do
END $$;
