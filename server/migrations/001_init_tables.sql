/*
基础表结构迁移：与运行时初始化保持一致，仅用于在CI/生产上固化schema。
*/

BEGIN;

CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY,
    title TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE,
    description TEXT,
    category TEXT,
    type TEXT,
    usage_guide TEXT,
    "like" INTEGER,
    status TEXT,
    title_cn TEXT,
    description_cn TEXT,
    usage_guide_cn TEXT,
    cover TEXT,
    example_output TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sourcing_runs (
    id TEXT PRIMARY KEY,
    platforms TEXT,
    keywords TEXT,
    count INTEGER,
    started_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tiktok_posts (
    id TEXT PRIMARY KEY,
    platform TEXT,
    run_id TEXT,
    keyword TEXT,
    author TEXT,
    url TEXT,
    title TEXT,
    description TEXT,
    published_at TIMESTAMPTZ,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    views INTEGER,
    followers INTEGER,
    fetched_at TIMESTAMPTZ DEFAULT now(),
    score DOUBLE PRECISION,
    raw_data JSONB
);

CREATE TABLE IF NOT EXISTS youtube_posts (
    id TEXT PRIMARY KEY,
    platform TEXT,
    run_id TEXT,
    keyword TEXT,
    author TEXT,
    url TEXT,
    title TEXT,
    description TEXT,
    published_at TIMESTAMPTZ,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    views INTEGER,
    followers INTEGER,
    fetched_at TIMESTAMPTZ DEFAULT now(),
    score DOUBLE PRECISION,
    raw_data JSONB
);

CREATE TABLE IF NOT EXISTS twitter_posts (
    id TEXT PRIMARY KEY,
    platform TEXT,
    run_id TEXT,
    keyword TEXT,
    author TEXT,
    url TEXT,
    title TEXT,
    description TEXT,
    published_at TIMESTAMPTZ,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    views INTEGER,
    followers INTEGER,
    fetched_at TIMESTAMPTZ DEFAULT now(),
    score DOUBLE PRECISION,
    raw_data JSONB
);

CREATE TABLE IF NOT EXISTS instagram_posts (
    id TEXT PRIMARY KEY,
    platform TEXT,
    run_id TEXT,
    keyword TEXT,
    author TEXT,
    url TEXT,
    title TEXT,
    description TEXT,
    published_at TIMESTAMPTZ,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    views INTEGER,
    followers INTEGER,
    fetched_at TIMESTAMPTZ DEFAULT now(),
    score DOUBLE PRECISION,
    raw_data JSONB
);

-- 索引（按查询使用场景）
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_fetched_at ON tiktok_posts (fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_youtube_posts_fetched_at ON youtube_posts (fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_twitter_posts_fetched_at ON twitter_posts (fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_fetched_at ON instagram_posts (fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_tiktok_posts_run_id ON tiktok_posts (run_id);

CREATE INDEX IF NOT EXISTS idx_youtube_posts_run_id ON youtube_posts (run_id);

CREATE INDEX IF NOT EXISTS idx_twitter_posts_run_id ON twitter_posts (run_id);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_run_id ON instagram_posts (run_id);

-- contents 表唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS contents_slug_key ON contents (slug);

COMMIT;