# 免费部署指南

本项目采用全免费技术栈部署：
- **数据库**: Neon (免费 PostgreSQL)
- **后端**: Render (免费 Web Service)
- **前端**: Vercel (免费静态托管)

## 步骤1: 创建 PostgreSQL 数据库

1. 访问 [Neon](https://neon.tech)
2. 使用 GitHub 账号注册/登录
3. 创建新项目，选择免费套餐
4. 复制数据库连接字符串（格式：`postgresql://username:password@host:5432/dbname`）

## 步骤2: 部署后端到 Render

1. 访问 [Render](https://render.com)
2. 连接您的 GitHub 账号
3. 点击 "New Web Service"
4. 选择此仓库
5. 配置如下：
   - **Name**: `batch-processing-backend`
   - **Region**: Singapore (或最近的区域)
   - **Branch**: main
   - **Root Directory**: `server`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

6. 在 "Environment Variables" 中添加：
   - `NODE_ENV` = `production`
   - `PORT` = `10000`
   - `DATABASE_URL` = `[您的 Neon 连接字符串]`
   - `CORS_ORIGINS` = `https://your-frontend.vercel.app` (稍后更新)

7. 点击 "Create Web Service"
8. 等待部署完成，记录后端 URL（如：`https://batch-processing-backend.onrender.com`）

## 步骤3: 部署前端到 Vercel

1. 访问 [Vercel](https://vercel.com)
2. 使用 GitHub 账号登录
3. 点击 "New Project"
4. 选择此仓库
5. 配置如下：
   - **Framework Preset**: Vite
   - **Root Directory**: `./` (项目根目录)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

6. 在 "Environment Variables" 中添加：
   - `VITE_API_BASE_URL` = `[您的后端 URL]`

7. 点击 "Deploy"
8. 部署完成后，记录前端 URL

## 步骤4: 更新 CORS 配置

1. 回到 Render 后端服务
2. 在环境变量中更新 `CORS_ORIGINS` 为您的前端 URL
3. 重新部署后端服务

## 步骤5: 验证部署

1. 访问后端健康检查：`https://your-backend.onrender.com/health`
2. 访问前端应用：`https://your-frontend.vercel.app`
3. 测试基础功能（如内容保存）

## 注意事项

- 免费套餐有一些限制：
  - Render: 服务会在无活动时休眠，首次访问可能较慢
  - Neon: 500MB 存储限制
  - Vercel: 100GB 带宽/月

- 外部 API 功能需要配置相应的环境变量：
  - `BRIGHT_DATA_API_KEY`: Bright Data API
  - `APIFY_TOKEN`: Apify 服务
  - `TINYPNG_API_KEY`: 图片压缩
  - 等等

- 不配置这些密钥不影响基础功能使用
