# Server

最小后端能力：
- 手动触发抓取（TikTok/YouTube/Twitter/Instagram）
- 拉取与清洗数据、入库 PostgreSQL
- 内容保存、图床代理、健康检查与基础指标

环境变量（.env）
- BRIGHT_DATA_API_KEY=...
- DATASET_ID_TIKTOK=gd_lu702nij2f790tmv9h
- DATASET_ID_YOUTUBE=gd_lk56epmy2i5g7lzu0k
- DATABASE_URL=postgresql://sourcing_user:password@localhost:5432/sourcing

启动
```bash
pnpm dev
```

数据库迁移（node-pg-migrate）
```bash
# 使用 DATABASE_URL 环境变量
pnpm migrate:up
# 回滚一步
pnpm migrate:down
```

说明
- 迁移文件位于 `server/migrations`，用于 CI/生产固化 schema。
- 运行时保留 `initPg()` 兜底建表；建议生产以迁移为准。
