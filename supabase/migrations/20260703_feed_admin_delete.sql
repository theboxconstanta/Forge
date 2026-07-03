-- feed_posts/feed_comments_delete permiteau stergere doar pe randul propriu
-- (member_id = auth.uid()), fara exceptie de admin - spre deosebire de restul
-- tabelelor critice actualizate in migratia de securitate din 2026-07-01.
-- Un admin care incearca sa stearga postarea/comentariul ALTUI membru lovea
-- 0 randuri (RLS filtreaza randul din USING), Postgres nu trateaza asta ca
-- eroare - clientul primea "succes" desi nu se stergea nimic.

DROP POLICY IF EXISTS "feed_posts_delete" ON feed_posts;
CREATE POLICY "feed_posts_delete" ON feed_posts FOR DELETE TO authenticated USING (member_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "feed_comments_delete" ON feed_comments;
CREATE POLICY "feed_comments_delete" ON feed_comments FOR DELETE TO authenticated USING (member_id = auth.uid() OR is_admin());
