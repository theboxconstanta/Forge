CREATE TABLE IF NOT EXISTS feed_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  text text NOT NULL,
  variant_level text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES feed_posts(id) ON DELETE CASCADE,
  member_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(post_id, member_id, emoji)
);

CREATE TABLE IF NOT EXISTS feed_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES feed_posts(id) ON DELETE CASCADE,
  member_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feed_posts_select" ON feed_posts;
DROP POLICY IF EXISTS "feed_posts_insert" ON feed_posts;
DROP POLICY IF EXISTS "feed_posts_delete" ON feed_posts;
DROP POLICY IF EXISTS "feed_reactions_select" ON feed_reactions;
DROP POLICY IF EXISTS "feed_reactions_insert" ON feed_reactions;
DROP POLICY IF EXISTS "feed_reactions_delete" ON feed_reactions;
DROP POLICY IF EXISTS "feed_comments_select" ON feed_comments;
DROP POLICY IF EXISTS "feed_comments_insert" ON feed_comments;
DROP POLICY IF EXISTS "feed_comments_delete" ON feed_comments;

CREATE POLICY "feed_posts_select" ON feed_posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "feed_posts_insert" ON feed_posts FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid());
CREATE POLICY "feed_posts_delete" ON feed_posts FOR DELETE TO authenticated USING (member_id = auth.uid());

CREATE POLICY "feed_reactions_select" ON feed_reactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "feed_reactions_insert" ON feed_reactions FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid());
CREATE POLICY "feed_reactions_delete" ON feed_reactions FOR DELETE TO authenticated USING (member_id = auth.uid());

CREATE POLICY "feed_comments_select" ON feed_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "feed_comments_insert" ON feed_comments FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid());
CREATE POLICY "feed_comments_delete" ON feed_comments FOR DELETE TO authenticated USING (member_id = auth.uid());
