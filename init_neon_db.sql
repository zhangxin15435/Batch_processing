-- 批量处理项目数据库初始化脚本
-- 为 Neon 数据库创建所有必要的表

-- 1. 内容表：存储生成的内容记录
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

-- 2. 选题发现运行记录表
CREATE TABLE IF NOT EXISTS sourcing_runs (
    id TEXT PRIMARY KEY,
    platforms TEXT, -- 逗号分隔的平台列表：tiktok,youtube,twitter,instagram
    keywords TEXT, -- 逗号分隔的关键词
    count INTEGER, -- 期望抓取条数
    started_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Instagram 帖子表
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

-- 4. TikTok 帖子表
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

-- 5. Twitter 帖子表
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

-- 6. YouTube 帖子表
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

-- 7. 为 contents 表创建 slug 列的唯一索引（如果不存在）
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'contents_slug_key') THEN 
        CREATE UNIQUE INDEX contents_slug_key ON contents(slug); 
    END IF; 
END $$;

-- 8. 显示创建完成的表
SELECT 'Tables created successfully!' as status;

-- 9. 列出所有创建的表
SELECT table_name
FROM information_schema.tables
WHERE
    table_schema = 'public'
    AND table_name IN (
        'contents',
        'sourcing_runs',
        'instagram_posts',
        'tiktok_posts',
        'twitter_posts',
        'youtube_posts'
    )
ORDER BY table_name;