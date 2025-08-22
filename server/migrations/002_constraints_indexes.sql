BEGIN;

-- 放宽 contents.title 唯一约束（若存在则移除），保留 slug 唯一
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'contents_title_key'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS contents_title_key';
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- 忽略
END $$;

-- 为四个平台表增加 published_at 索引（便于时间过滤）
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_published_at ON tiktok_posts (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_youtube_posts_published_at ON youtube_posts (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_twitter_posts_published_at ON twitter_posts (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_published_at ON instagram_posts (published_at DESC);

COMMIT;