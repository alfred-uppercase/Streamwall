-- StreamWall / Tapenaka PostgreSQL performance indexes (idempotent & safe on Supabase Free)
-- Execute in Supabase SQL Editor. Each index checks table & column presence first.

DO $$
BEGIN
  -- 1. watch_events: accélère /api/home, /api/member, film_rankings et admin_top_titles
  IF to_regclass('public.watch_events') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'watch_events' AND column_name = 'viewed_at'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_watch_events_viewed_at_desc
        ON public.watch_events (viewed_at DESC);

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'watch_events' AND column_name = 'user_id'
      ) THEN
        CREATE INDEX IF NOT EXISTS idx_watch_events_user_viewed_desc
          ON public.watch_events (user_id, viewed_at DESC);
      END IF;
    END IF;
  END IF;

  -- 2. favorites: accélère /api/member et le toggle favoris
  IF to_regclass('public.favorites') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'favorites' AND column_name = 'user_id'
    ) THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'favorites' AND column_name = 'created_at'
      ) THEN
        CREATE INDEX IF NOT EXISTS idx_favorites_user_created_desc
          ON public.favorites (user_id, created_at DESC);
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'favorites' AND column_name = 'item_type'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'favorites' AND column_name = 'item_id'
      ) THEN
        CREATE INDEX IF NOT EXISTS idx_favorites_user_item_lookup
          ON public.favorites (user_id, item_type, item_id);
      END IF;
    END IF;
  END IF;

  -- 3. comments: accélère /api/comments/:type/:id et l'aperçu admin
  IF to_regclass('public.comments') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'item_type'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'item_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'created_at'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_comments_item_created_asc
        ON public.comments (item_type, item_id, created_at ASC);
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'created_at'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_comments_created_desc
        ON public.comments (created_at DESC);
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'user_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_comments_user_id
        ON public.comments (user_id);
    END IF;
  END IF;

  -- 4. friendships: accélère la liste d'amis et la suppression bidirectionnelle
  IF to_regclass('public.friendships') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'friendships' AND column_name = 'user_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'friendships' AND column_name = 'friend_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_friendships_user_friend
        ON public.friendships (user_id, friend_id);
      CREATE INDEX IF NOT EXISTS idx_friendships_friend_id
        ON public.friendships (friend_id);
    END IF;
  END IF;

  -- 5. user_roles: accélère la résolution auth/admin sur chaque requête non cachée
  IF to_regclass('public.user_roles') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'user_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'role'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_user_roles_user_role
        ON public.user_roles (user_id, role);
    END IF;
  END IF;

  -- 6. profiles: accélère la recherche de mentions @pseudo (insensible à la casse)
  IF to_regclass('public.profiles') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'username'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_profiles_username_lower
        ON public.profiles (lower(username));
    END IF;
  END IF;
END
$$;

-- Met à jour les statistiques du planificateur PostgreSQL
DO $$
BEGIN
  IF to_regclass('public.watch_events') IS NOT NULL THEN ANALYZE public.watch_events; END IF;
  IF to_regclass('public.favorites') IS NOT NULL THEN ANALYZE public.favorites; END IF;
  IF to_regclass('public.comments') IS NOT NULL THEN ANALYZE public.comments; END IF;
  IF to_regclass('public.friendships') IS NOT NULL THEN ANALYZE public.friendships; END IF;
  IF to_regclass('public.user_roles') IS NOT NULL THEN ANALYZE public.user_roles; END IF;
  IF to_regclass('public.profiles') IS NOT NULL THEN ANALYZE public.profiles; END IF;
  IF to_regclass('public.app_settings') IS NOT NULL THEN ANALYZE public.app_settings; END IF;
END
$$;
