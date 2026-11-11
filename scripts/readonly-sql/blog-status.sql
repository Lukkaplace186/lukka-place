-- Lukka Place — is the blog ready? (READ ONLY: one SELECT, writes nothing)
-- Paste into Supabase > SQL Editor and Run. Works even if blog_posts was never created.
SELECT
  to_regclass('public.blog_posts') IS NOT NULL AS blog_table_exists,
  -- the /admin/settings switch "Guides & Actualités"; NULL or absent = off (the default)
  (SELECT (value::jsonb) ->> 'publicBlog' FROM cms_settings WHERE key = 'site.features') AS public_blog_switch,
  (SELECT updated_at FROM cms_settings WHERE key = 'site.features') AS features_updated_at,
  CASE WHEN to_regclass('public.blog_posts') IS NULL THEN NULL ELSE
    (xpath('/row/n/text()', query_to_xml(
      'SELECT COUNT(*) AS n FROM blog_posts WHERE deleted_at IS NULL', false, true, '')))[1]::text::int
  END AS posts_live,
  CASE WHEN to_regclass('public.blog_posts') IS NULL THEN NULL ELSE
    (xpath('/row/n/text()', query_to_xml(
      $q$SELECT COUNT(*) AS n FROM blog_posts WHERE deleted_at IS NULL AND status = 'published' AND published_at <= NOW()$q$, false, true, '')))[1]::text::int
  END AS posts_published,
  CASE WHEN to_regclass('public.blog_posts') IS NULL THEN NULL ELSE
    (xpath('/row/n/text()', query_to_xml(
      $q$SELECT COUNT(*) AS n FROM blog_posts WHERE deleted_at IS NULL AND status = 'draft'$q$, false, true, '')))[1]::text::int
  END AS posts_draft,
  (SELECT MAX(month) FROM market_snapshots_monthly) AS latest_snapshot_month,
  (SELECT MAX(last_seen_at) FROM market_observations) AS latest_observation_seen;
