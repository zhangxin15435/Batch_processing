# 针对免费云平台优化的多阶段构建
FROM node:18-alpine AS base

# 设置工作目录
WORKDIR /app

# 复制包管理文件
COPY package.json ./
COPY pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# 安装依赖（生产环境）
RUN pnpm install --prod --frozen-lockfile

# 复制应用代码
COPY src/ ./src/
COPY data/ ./data/

# 创建非root用户（安全最佳实践）
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8787/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# 暴露端口
EXPOSE 8787

# 启动命令
CMD ["node", "src/index.js"]


