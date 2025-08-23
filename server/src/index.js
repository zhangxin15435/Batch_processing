// 批量处理后端服务
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import pino from 'pino'
import pinoHttp from 'pino-http'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import fs from 'fs'
import https from 'https'
import http from 'http'
import crypto from 'crypto'
import pkg from 'pg'
import { ApifyClient } from 'apify-client'
import FormData from 'form-data'
import fetch from 'node-fetch'
import Jimp from 'jimp'
// v2Router 已迁移到独立新项目，不在此处挂载

// 优先加载 server/.env，若缺失则尝试加载项目根目录 .env
dotenv.config()
try {
    const __filenameBoot = fileURLToPath(import.meta.url)
    const __dirnameBoot = path.dirname(__filenameBoot)
    dotenv.config({ path: path.resolve(__dirnameBoot, '../../.env') })
} catch { }

// 环境变量
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_KEY || ''
const DATASET_ID_TIKTOK = process.env.DATASET_ID_TIKTOK || 'gd_lu702nij2f790tmv9h'
// YouTube 数据集（Bright Data: TikTok/YouTube 均走 Marketplace Dataset API）
const DATASET_ID_YOUTUBE = process.env.DATASET_ID_YOUTUBE || 'gd_lk56epmy2i5g7lzu0k'
// Apify：用于 Instagram/TikTok 抓取
const APIFY_TOKEN = process.env.APIFY_TOKEN || ''
const APIFY_IG_ACTOR = process.env.APIFY_IG_ACTOR || 'shu8hvrXbJbY3Eb9W'
const APIFY_TT_ACTOR = process.env.APIFY_TT_ACTOR || 'GdWCkxBtKWOsKjdch'
// Instagram 登录会话，用于提升详情抓取可见性（点赞/评论/粉丝）
const IG_SESSIONID = process.env.IG_SESSIONID || process.env.APIFY_IG_SESSIONID || ''
// Lark (Feishu) Bitable
const LARK_APP_TOKEN = process.env.LARK_APP_TOKEN || ''
const LARK_TABLE_ID = process.env.LARK_TABLE_ID || ''
const LARK_VIEW_ID = process.env.VIEW_ID || ''
const LARK_APP_ID = process.env.LARK_APP_ID || ''
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || ''
// TinyPNG：图片压缩 API Key（优先环境变量，回落到默认给定值）
const TINYPNG_API_KEY = process.env.TINYPNG_API_KEY || ''
// 复用的 HTTP/HTTPS Agent，开启 keep-alive，缓解偶发 socket hang up
const KEEPALIVE_AGENT_HTTPS = new https.Agent({ keepAlive: true })
const KEEPALIVE_AGENT_HTTP = new http.Agent({ keepAlive: true })
const PICK_AGENT = (urlLike) => {
    try {
        const u = typeof urlLike === 'string' ? new URL(urlLike) : urlLike
        return u.protocol === 'http:' ? KEEPALIVE_AGENT_HTTP : KEEPALIVE_AGENT_HTTPS
    } catch {
        return KEEPALIVE_AGENT_HTTPS
    }
}

if (!BRIGHT_DATA_API_KEY) {
    console.warn('[warn] BRIGHT_DATA_API_KEY 未配置，接口将无法访问 Bright Data')
}
if (!APIFY_TOKEN) {
    console.warn('[warn] APIFY_TOKEN 未配置，Instagram/TikTok 接口将不可用')
}
if (!process.env.TINYPNG_API_KEY) {
    console.warn('[warn] TINYPNG_API_KEY 未显式配置，正在使用内置默认 Key（建议在生产环境设置环境变量）')
}

// 轻量存储（JSONL），用于实时入库与前端渲染（零依赖）
// 始终定位到 server/data 目录（与源码文件同级的上层 data 目录）
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const POSTS_FILE = path.join(DATA_DIR, 'posts.jsonl')
const CONTENTS_FILE = path.join(DATA_DIR, 'contents.jsonl')

// 确保存储目录与文件存在
function ensureDataFile() {
    // 已迁移到 PostgreSQL：不再创建或写入 JSONL 文件
    return
}
// 已迁移到 PostgreSQL，移除 JSONL 初始化

// 兼容旧函数：已废弃，改为写入 PostgreSQL。保留空实现以防旧调用崩溃。
function savePostsToDb(_items) { /* no-op */ }

// 轻量内容存储：保存与读取工作流产出（JSONL）
const { Pool } = pkg
const DATABASE_URL = process.env.DATABASE_URL || process.env.PGDATABASE_URL || 'postgresql://sourcing_user:711711@localhost:5432/sourcing'
const pgPool = new Pool({ connectionString: DATABASE_URL })

async function initPg() {
    try {
        await pgPool.query(`
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
        `)

        // 选题发现记录表：记录每次前端触发的"选题发现"动作
        await pgPool.query(`
            CREATE TABLE IF NOT EXISTS sourcing_runs (
                id TEXT PRIMARY KEY,
                platforms TEXT,          -- 逗号分隔的平台列表：tiktok,youtube,twitter,instagram
                keywords TEXT,           -- 逗号分隔的关键词
                count INTEGER,           -- 期望抓取条数
                started_at TIMESTAMPTZ DEFAULT now()
            );
        `)
        // 迁移：为已有表补充 slug 列与唯一索引
        await pgPool.query('ALTER TABLE contents ADD COLUMN IF NOT EXISTS slug TEXT;')
        await pgPool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'contents_slug_key') THEN CREATE UNIQUE INDEX contents_slug_key ON contents(slug); END IF; END $$;")

        // —— 新增：为不同平台建立独立的帖子表，并存储完整原始字段（raw_data JSONB） ——
        await pgPool.query(`
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
        `)

        await pgPool.query(`
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
        `)

        await pgPool.query(`
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
        `)

        await pgPool.query(`
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
        `)

        console.log('[pg] 数据库表初始化完成')
    } catch (e) {
        console.error('[pg] 数据库初始化失败:', e?.message || e)
    }
}

// 哈希工具函数
function hashOf(platform, url, timestamp) {
    return crypto.createHash('sha256').update(`${platform}:${url}:${timestamp}`).digest('hex').slice(0, 16)
}

// Express 应用
const app = express()
const PORT = process.env.PORT || 8787

// 安全与性能中间件（基础）
// 结构化日志
const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
app.use(pinoHttp({ logger }))
app.use(helmet({ crossOriginResourcePolicy: false }))
app.use(compression())

// CORS 白名单：环境变量 CORS_ORIGINS=origin1,origin2
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
app.use((req, res, next) => {
    const origin = req.headers.origin
    if (!origin || CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin)) return next()
    return res.status(403).json({ error: 'CORS not allowed', origin })
})
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '50mb' }))
// 基础限流：保护写接口
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 })
app.use(['/api/image', '/api/content', '/api/sourcing'], limiter)

// 将 DataURL 转为 Buffer
function dataUrlToBuffer(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        throw new Error('无效的 DataURL')
    }
    const comma = dataUrl.indexOf(',')
    const meta = dataUrl.slice(0, comma)
    const base64 = dataUrl.slice(comma + 1)
    return Buffer.from(base64, 'base64')
}

async function arrayBufferToBuffer(ab) {
    return Buffer.from(Buffer.from(await ab))
}

async function fetchBuffer(url) {
    const r = await fetch(url, { agent: PICK_AGENT(url) })
    if (!r.ok) throw new Error(`获取背景失败(${r.status})`)
    const ab = await r.arrayBuffer()
    return Buffer.from(ab)
}

async function readLocalBuffer(p) {
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), 'server', p)
    return await fs.promises.readFile(abs)
}

// 代理上传到图床（multipart/form-data）
async function uploadBufferToHosting(buffer, filename, mime, endpoint, apiKey) {
    if (!endpoint) throw new Error('缺少图床 endpoint')
    const form = new FormData()
    form.append('file', buffer, { filename: filename || 'upload.png', contentType: mime || 'application/octet-stream' })
    const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
            ...(apiKey ? { 'x-api-key': apiKey } : {}),
            ...form.getHeaders?.() // node FormData
        },
        body: form
    })
    const ct = resp.headers.get('content-type') || ''
    const body = ct.includes('application/json') ? await resp.json().catch(() => ({})) : await resp.text().catch(() => '')
    if (!resp.ok) {
        const msg = typeof body === 'string' ? body : (body?.error || body?.message || '上传失败')
        throw new Error(`${msg}(${resp.status})`)
    }
    // 兼容不同结构
    const url = (body?.data?.url) || (body?.url) || (body?.data?.link) || ''
    if (!url) throw new Error('上传成功但未返回URL')
    return { url, raw: body }
}

// 使用 TinyPNG 压缩 Buffer（如果环境变量存在）
async function compressWithTinyPng(buffer, mime = 'image/png') {
    const key = process.env.TINYPNG_API_KEY
    if (!key) return buffer
    const auth = 'Basic ' + Buffer.from(`api:${key}`).toString('base64')
    const shrinkEndpoint = 'https://api.tinify.com/shrink'
    const shrinkResp = await fetch(shrinkEndpoint, {
        method: 'POST',
        headers: {
            'Authorization': auth,
            'Content-Type': mime || 'application/octet-stream'
        },
        agent: PICK_AGENT(shrinkEndpoint),
        body: buffer
    })
    const location = shrinkResp.headers.get('location') || shrinkResp.headers.get('Location')
    if (!shrinkResp.ok || !location) {
        const txt = await shrinkResp.text().catch(() => '')
        throw new Error(`TinyPNG 压缩失败(${shrinkResp.status}): ${txt}`)
    }
    const finalResp = await fetch(location, {
        method: 'GET',
        headers: { 'Authorization': auth },
        agent: PICK_AGENT(location)
    })
    if (!finalResp.ok) {
        const txt = await finalResp.text().catch(() => '')
        throw new Error(`TinyPNG 下载失败(${finalResp.status}): ${txt}`)
    }
    const ab = await finalResp.arrayBuffer()
    return Buffer.from(ab)
}

// 基础直传：/api/image/upload
app.post('/api/image/upload', async (req, res) => {
    try {
        const { filename = 'upload.png', mime = 'application/octet-stream', data, endpoint, apiKey } = req.body || {}
        if (!data || !endpoint) return res.status(400).json({ success: false, error: '缺少必要参数(data/endpoint)' })
        const buf = dataUrlToBuffer(String(data))
        const result = await uploadBufferToHosting(buf, filename, mime, String(endpoint), apiKey)
        return res.json({ success: true, data: { url: result.url } })
    } catch (e) {
        return res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

// 仅压缩（返回 DataURL）：/api/image/tinypng
app.post('/api/image/tinypng', async (req, res) => {
    try {
        const { data, mime = 'image/png' } = req.body || {}
        if (!data) return res.status(400).json({ success: false, error: '缺少参数 data' })
        if (!process.env.TINYPNG_API_KEY) return res.status(400).json({ success: false, error: '未配置 TINYPNG_API_KEY' })
        const buf = dataUrlToBuffer(String(data))
        const compressed = await compressWithTinyPng(buf, String(mime || 'image/png'))
        const dataUrl = `data:${mime};base64,${compressed.toString('base64')}`
        return res.json({ success: true, data: { dataUrl } })
    } catch (e) {
        return res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

// 合成背景后再上传：/api/image/upload-with-bg
app.post('/api/image/upload-with-bg', async (req, res) => {
    try {
        const { filename = 'upload.png', mime = 'image/png', data, endpoint, apiKey, bgUrl, bgIndex, region } = req.body || {}
        if (!data || !endpoint) return res.status(400).json({ success: false, error: '缺少必要参数(data/endpoint)' })

        const inputBuffer = dataUrlToBuffer(String(data))
        const src = await Jimp.read(inputBuffer)

        // 背景来源（必须提供，不再创建兜底背景）：
        // 1) 请求体 bgUrl（支持本地路径/HTTP(S)/dataURL）
        // 2) 环境变量：BG_PATH_0..N / BG_URL_0..N（任意数量）。bgIndex 将按候选数量取模。
        let bgBuffer = null
        if (bgUrl) {
            const s = String(bgUrl)
            if (s.startsWith('data:')) {
                bgBuffer = dataUrlToBuffer(s)
            } else if (/^https?:\/\//i.test(s)) {
                bgBuffer = await fetchBuffer(s)
            } else {
                bgBuffer = await readLocalBuffer(s)
            }
        } else {
            const envEntries = Object.entries(process.env)
            const pathList = envEntries
                .filter(([k, v]) => /^BG_PATH_\d+$/i.test(k) && v)
                .sort((a, b) => Number(a[0].match(/\d+/)?.[0] || 0) - Number(b[0].match(/\d+/)?.[0] || 0))
                .map(([, v]) => String(v))
            const urlList = envEntries
                .filter(([k, v]) => /^BG_URL_\d+$/i.test(k) && v)
                .sort((a, b) => Number(a[0].match(/\d+/)?.[0] || 0) - Number(b[0].match(/\d+/)?.[0] || 0))
                .map(([, v]) => String(v))
            const candidates = [...pathList, ...urlList]
            if (candidates.length > 0) {
                const idxRaw = typeof bgIndex === 'number' && !Number.isNaN(bgIndex) ? Number(bgIndex) : 0
                const idx = ((idxRaw % candidates.length) + candidates.length) % candidates.length
                const pick = candidates[idx]
                if (/^https?:\/\//i.test(pick)) {
                    bgBuffer = await fetchBuffer(pick)
                } else if (pick.startsWith('data:')) {
                    bgBuffer = dataUrlToBuffer(pick)
                } else {
                    bgBuffer = await readLocalBuffer(pick)
                }
            }
        }

        if (!bgBuffer) {
            return res.status(400).json({ success: false, error: '缺少背景图。请在请求体提供 bgUrl，或配置 BG_PATH_0/BG_PATH_1（本地路径）或 BG_URL_0/BG_URL_1（远程地址）。' })
        }

        const bg = await Jimp.read(bgBuffer)

        // 目标区域（默认 1280x720 画布内的 995x546 区域，位置 141x88）
        const regionConf = {
            left: Math.max(0, Number(region?.left ?? 141)),
            top: Math.max(0, Number(region?.top ?? 88)),
            width: Math.max(1, Number(region?.width ?? 995)),
            height: Math.max(1, Number(region?.height ?? 546))
        }

        // 等比例缩放，contain 到区域内
        const scale = Math.min(regionConf.width / src.bitmap.width, regionConf.height / src.bitmap.height)
        const newW = Math.max(1, Math.round(src.bitmap.width * scale))
        const newH = Math.max(1, Math.round(src.bitmap.height * scale))
        src.resize(newW, newH)
        const dx = regionConf.left + Math.round((regionConf.width - newW) / 2)
        const dy = regionConf.top + Math.round((regionConf.height - newH) / 2)
        bg.composite(src, dx, dy)

        const outMime = 'image/png'
        let outBuffer = await bg.getBufferAsync(outMime)
        // TinyPNG 压缩（若配置了密钥）
        try {
            outBuffer = await compressWithTinyPng(outBuffer, outMime)
        } catch (e) {
            console.warn('TinyPNG 压缩失败，使用未压缩版本：', e?.message || e)
        }
        const result = await uploadBufferToHosting(outBuffer, filename.replace(/\.[^.]+$/, '') + '.png', outMime, String(endpoint), apiKey)
        return res.json({ success: true, data: { url: result.url } })
    } catch (e) {
        return res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// 启动时初始化数据库
initPg().catch(console.error)

// 兼容前端：记录一次选题发现（POST /api/sourcing/runs）
app.post('/api/sourcing/runs', async (req, res) => {
    try {
        const { id = '', platforms = [], keywords = [], count = 20 } = req.body || {}
        const rid = await createSourcingRun({ id, platforms, keywords, count })
        return res.json({ ok: true, id: rid })
    } catch (e) {
        console.error('[runs] create error:', e)
        return res.status(500).json({ error: '创建记录失败' })
    }
})

// 兼容前端：直接返回最新 TikTok 数据（数据库中）
app.get('/api/sourcing/tiktok/latest', async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(500, Number(req.query.count) || 20))
        const r = await pgPool.query('SELECT * FROM tiktok_posts ORDER BY fetched_at DESC NULLS LAST LIMIT $1', [limit])
        return res.json({ items: r.rows || [] })
    } catch (e) {
        console.error('[tiktok/latest] 查询失败:', e)
        return res.status(500).json({ error: '读取失败' })
    }
})

// 兼容前端：直接返回最新 YouTube 数据（数据库中）
app.get('/api/sourcing/youtube/latest', async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(500, Number(req.query.count) || 20))
        const r = await pgPool.query('SELECT * FROM youtube_posts ORDER BY fetched_at DESC NULLS LAST LIMIT $1', [limit])
        return res.json({ items: r.rows || [] })
    } catch (e) {
        console.error('[youtube/latest] 查询失败:', e)
        return res.status(500).json({ error: '读取失败' })
    }
})

// 保存不同平台的帖子到对应数据表
async function saveTwitterPosts(items, runId = '') {
    if (!Array.isArray(items) || items.length === 0) return 0
    const client = await pgPool.connect()
    try {
        let saved = 0
        for (const it of items) {
            const id = it.postId || it.id || hashOf('twitter', it.url || '', it.published_at || '')
            await client.query(`
                INSERT INTO twitter_posts (id, platform, run_id, keyword, author, url, title, description, published_at, likes, comments, shares, views, followers, fetched_at, score, raw_data)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (id) DO UPDATE SET
                    run_id = COALESCE(EXCLUDED.run_id, twitter_posts.run_id),
                    keyword = COALESCE(EXCLUDED.keyword, twitter_posts.keyword),
                    score = COALESCE(EXCLUDED.score, twitter_posts.score)
            `, [
                id, 'twitter', runId || '', it.keyword || '', it.author || '', it.url || '',
                it.title || '', it.desc || it.description || '', it.published_at || null,
                it.likes || 0, it.comments || 0, it.shares || 0, it.views || 0, it.followers || 0,
                new Date().toISOString(), it.score || 0, JSON.stringify(it)
            ])
            saved++
        }
        return saved
    } catch (e) {
        console.error('[saveTwitterPosts] 数据库写入失败:', e?.message || e)
        return 0
    } finally {
        client.release()
    }
}

async function saveTikTokPosts(items, runId = '') {
    if (!Array.isArray(items) || items.length === 0) return 0
    const client = await pgPool.connect()
    try {
        let saved = 0
        console.log('[saveTikTokPosts] 开始保存', items.length, '条数据到数据库（不去重）')

        for (const it of items) {
            const id = it.postId || it.id || hashOf('tiktok', (it.url || '') + '|' + (it.published_at || ''), '')
            await client.query(`
                INSERT INTO tiktok_posts (id, platform, run_id, keyword, author, url, title, description, published_at, likes, comments, shares, views, followers, fetched_at, score, raw_data)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                ON CONFLICT (id) DO UPDATE SET
                    run_id = COALESCE(EXCLUDED.run_id, tiktok_posts.run_id),
                    keyword = COALESCE(EXCLUDED.keyword, tiktok_posts.keyword),
                    score = COALESCE(EXCLUDED.score, tiktok_posts.score)
            `, [
                id, 'tiktok', runId || '', it.keyword || '', it.author || '', it.url || '',
                it.title || '', it.desc || it.description || '', it.published_at || null,
                it.likes || 0, it.comments || 0, it.shares || 0, it.views || 0, it.followers || 0,
                new Date().toISOString(), it.score || 0, JSON.stringify(it.raw_data ?? it)
            ])
            saved++
        }

        console.log('[saveTikTokPosts] 保存完成 - 成功:', saved, '条')
        return saved
    } catch (e) {
        console.error('[saveTikTokPosts] 批量保存失败:', e?.message || e)
        return 0
    } finally {
        client.release()
    }
}

async function saveYouTubePosts(items, runId = '') {
    if (!Array.isArray(items) || items.length === 0) return 0
    const client = await pgPool.connect()
    try {
        let saved = 0
        for (const it of items) {
            const id = it.postId || it.id || hashOf('youtube', it.url || '', it.published_at || '')
            await client.query(`
                INSERT INTO youtube_posts (id, platform, run_id, keyword, author, url, title, description, published_at, likes, comments, shares, views, followers, fetched_at, score, raw_data)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (id) DO UPDATE SET
                run_id = COALESCE(EXCLUDED.run_id, youtube_posts.run_id),
                    keyword = COALESCE(EXCLUDED.keyword, youtube_posts.keyword),
                    score = COALESCE(EXCLUDED.score, youtube_posts.score)
            `, [
                id, 'youtube', runId || '', it.keyword || '', it.author || '', it.url || '',
                it.title || '', it.desc || it.description || '', it.published_at || null,
                it.likes || 0, it.comments || 0, it.shares || 0, it.views || 0, it.followers || 0,
                new Date().toISOString(), it.score || 0, JSON.stringify(it)
            ])
            saved++
        }
        return saved
    } catch (e) {
        console.error('[saveYouTubePosts] 数据库写入失败:', e?.message || e)
        return 0
    } finally {
        client.release()
    }
}

async function saveInstagramPosts(items, runId = '') {
    if (!Array.isArray(items) || items.length === 0) return 0
    const client = await pgPool.connect()
    try {
        let saved = 0
        for (const it of items) {
            const id = it.postId || it.id || hashOf('instagram', it.url || '', it.published_at || '')
            await client.query(`
                INSERT INTO instagram_posts (id, platform, run_id, keyword, author, url, title, description, published_at, likes, comments, shares, views, followers, fetched_at, score, raw_data)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                ON CONFLICT (id) DO UPDATE SET
                    run_id = COALESCE(EXCLUDED.run_id, instagram_posts.run_id),
                    keyword = COALESCE(EXCLUDED.keyword, instagram_posts.keyword),
                    score = COALESCE(EXCLUDED.score, instagram_posts.score)
            `, [
                id, 'instagram', runId || '', it.keyword || '', it.author || '', it.url || '',
                it.title || '', it.desc || it.description || '', it.published_at || null,
                it.likes || 0, it.comments || 0, it.shares || 0, it.views || 0, it.followers || 0,
                new Date().toISOString(), it.score || 0, JSON.stringify(it)
            ])
            saved++
        }
        return saved
    } catch (e) {
        console.error('[saveInstagramPosts] 数据库写入失败:', e?.message || e)
        return 0
    } finally {
        client.release()
    }
}

// 简易内存 Job 存储（仅用于 MVP-1 轮询过滤）
const jobs = new Map() // jobId -> { keywords: string[], startedAt: number, snapshotId?: string }

// 记录一次选题发现运行
async function createSourcingRun({ id, platforms, keywords, count }) {
    try {
        const pid = id || `${Date.now()}`
        const pf = Array.isArray(platforms) ? platforms.join(',') : String(platforms || '')
        const kw = Array.isArray(keywords) ? keywords.join(',') : String(keywords || '')
        const c = Math.max(1, Number(count) || 20)
        const sql = `
            INSERT INTO sourcing_runs (id, platforms, keywords, count)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (id) DO UPDATE SET
                platforms = COALESCE(
                    NULLIF((
                        SELECT string_agg(DISTINCT v, ',')
                        FROM unnest(string_to_array(concat_ws(',', sourcing_runs.platforms, EXCLUDED.platforms), ',')) AS v
                        WHERE length(trim(v)) > 0
                    ), sourcing_runs.platforms),
                    sourcing_runs.platforms
                ),
                keywords = COALESCE(
                    NULLIF((
                        SELECT string_agg(DISTINCT v, ',')
                        FROM unnest(string_to_array(concat_ws(',', sourcing_runs.keywords, EXCLUDED.keywords), ',')) AS v
                        WHERE length(trim(v)) > 0
                    ), sourcing_runs.keywords),
                    sourcing_runs.keywords
                ),
                count = GREATEST(sourcing_runs.count, EXCLUDED.count),
                started_at = LEAST(sourcing_runs.started_at, NOW())
        `
        await pgPool.query(sql, [pid, pf, kw, c])
        return pid
    } catch (e) {
        console.warn('[sourcing_runs] create error:', e?.message || e)
        return id
    }
}

// 通用：评分与裁切
function rankAndSlice(normalized, count) {
    // 不再进行打分与按分数排序，直接保持原有顺序并裁切数量
    return normalized.slice(0, Math.max(1, Number(count) || 20))
}

// 触发 Twitter 抓取：调用本地 Python 脚本 server/src/twitter_fetch.py，并将结果入库
// 请求体：{ keywords: string[], count: number }
app.post('/api/sourcing/twitter/trigger', async (req, res) => {
    try {
        const { keywords = [], count = 20, mode = 'latest', runId = '' } = req.body || {}
        const rid = String(runId || `${Date.now()}-twitter`)
        if (runId) {
            await createSourcingRun({ id: rid, platforms: ['twitter'], keywords, count })
        }
        if (!Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({ error: 'keywords 不能为空' })
        }

        // 必要的 Cookie 登录态（从环境变量传给 Python 脚本）
        const AUTH = process.env.TWITTER_AUTH_TOKEN || process.env.AUTH_TOKEN || ''
        const CT0 = process.env.TWITTER_CT0 || process.env.CT0 || ''
        if (!AUTH || !CT0) {
            return res.status(500).json({ error: '缺少 TWITTER_AUTH_TOKEN 或 TWITTER_CT0 环境变量' })
        }

        // 优先使用虚拟环境中的Python，其次环境变量 PYTHON_BIN，最后 python/py
        const venvPython = path.resolve(__dirname, '../../.venv/Scripts/python.exe')
        const pyBin = (fs.existsSync(venvPython) ? venvPython : process.env.PYTHON_BIN) || 'python'
        const scriptPath = path.resolve(__dirname, 'twitter_fetch.py')
        const runOnce = (bin, args) => new Promise(resolve => {
            const p = spawn(bin, args, {
                env: { ...process.env, TWITTER_AUTH_TOKEN: AUTH, TWITTER_CT0: CT0 },
                cwd: path.resolve(__dirname)
            })
            let stdout = ''
            let stderr = ''
            p.stdout.on('data', (d) => { stdout += d.toString('utf-8') })
            p.stderr.on('data', (d) => { stderr += d.toString('utf-8') })
            p.on('close', (code) => {
                resolve({ code, stdout, stderr })
            })
            p.on('error', (err) => {
                resolve({ code: -1, stdout, stderr: (stderr || '') + String(err?.message || err) })
            })
        })

        // —— 逐关键词执行 Python ——
        const kwList = keywords.map(k => String(k).trim()).filter(Boolean)
        const perKwCount = Math.max(1, Number(count) || 20)
        let all = []
        for (const kw of kwList) {
            const args = [
                scriptPath,
                '--keywords', kw,
                '--count', String(perKwCount),
                '--mode', String(mode || 'latest')
            ]
            let r = await runOnce(pyBin, args)
            if ((r.code === -1 || r.code === 127) && pyBin !== 'py') {
                r = await runOnce('py', args)
            }
            let items = []
            try {
                const parsed = JSON.parse((r.stdout || '').trim() || '[]')
                if (Array.isArray(parsed)) items = parsed
            } catch { }
            if (!Array.isArray(items)) items = []
            if ((r.code !== 0) && items.length === 0) {
                return res.status(500).json({ error: 'twitter_fetch 运行失败', detail: r.stderr || r.stdout })
            }
            // 标注关键词，确保每条有 keyword 字段
            items = items.map(it => ({ ...it, keyword: it.keyword || kw }))
            // 若脚本返回超额，这里按每关键词限制裁切
            if (items.length > perKwCount) items = items.slice(0, perKwCount)
            all.push(...items)
        }

        const saved = await saveTwitterPosts(all, rid)
        return res.json({ items: all, saved, runId: rid })
    } catch (e) {
        console.error(e)
        return res.status(500).json({ error: 'twitter 触发异常' })
    }
})

// 关键词搜索 Instagram（Apify Actor）并实时入库
// 请求体：{ keywords: string[], type?: 'hashtag'|'profile', limit?: number }
app.post('/api/sourcing/instagram/search', async (req, res) => {
    try {
        const { keywords = [], type = 'hashtag', limit = 50, hydrate = true, runId = '' } = req.body || {}
        const rid = String(runId || `${Date.now()}-instagram`)
        if (runId) {
            await createSourcingRun({ id: rid, platforms: ['instagram'], keywords, count: Number(limit) || 50 })
        }
        if (!APIFY_TOKEN) return res.status(500).json({ error: '缺少 APIFY_TOKEN 环境变量' })
        if (!Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({ error: 'keywords 不能为空' })
        }

        const client = new ApifyClient({ token: APIFY_TOKEN })

        // 组装 Actor 输入：支持 hashtag 搜索或 profile 抓取
        // - hashtag: 通过 searchType='hashtag' 并提供 keywords
        // - profile: 通过 directUrls 填入 https://www.instagram.com/<handle>/
        const inputBase = {
            resultsType: 'posts',
            // 修复：确保多个关键词时能获得更多数据
            resultsLimit: Number(limit) * Math.max(1, keywords.length),
            // 开启父级数据，尽可能带回作者等信息（包括粉丝数等）
            addParentData: true,
        }

        let input
        if (type === 'profile') {
            const directUrls = keywords
                .map(k => String(k).trim())
                .filter(Boolean)
                .map(k => k.startsWith('http') ? k : `https://www.instagram.com/${k.replace(/^@/, '')}/`)
            input = { ...inputBase, directUrls, sessionid: IG_SESSIONID || undefined }
        } else {
            // 使用 directUrls 方式直接指向 hashtag 页面，让 Actor 抓取该页面下的帖子
            const directUrls = keywords
                .map(k => String(k).trim())
                .filter(Boolean)
                .map(k => `https://www.instagram.com/explore/tags/${k.replace(/^#/, '')}/`)
            input = { ...inputBase, directUrls, sessionid: IG_SESSIONID || undefined }
        }

        // 对于 hashtag 搜索，优先使用专门的 Hashtag Scraper，更可靠
        let run, items
        if (type === 'hashtag') {
            try {
                // 使用专门的 Instagram Hashtag Scraper
                // 修复：确保每个hashtag都获得指定数量的数据，而不是总共limit条
                const htInput = {
                    hashtags: keywords.map(k => String(k).replace(/^#/, '')),
                    resultsLimit: Number(limit) * keywords.length, // 每个hashtag获得limit条数据
                    sessionid: IG_SESSIONID || undefined
                }
                console.log('[instagram/hashtag] 调用专用 Hashtag Scraper，输入:', JSON.stringify(htInput, null, 2))
                run = await client.actor('apify/instagram-hashtag-scraper').call(htInput)
                const result = await client.dataset(run.defaultDatasetId).listItems()
                items = result.items
                console.log('[instagram/hashtag] 专用 Scraper 返回数据量:', items?.length || 0)
                console.log('[instagram/hashtag] 前3条原始数据:', JSON.stringify((items || []).slice(0, 3), null, 2))
            } catch (e) {
                console.warn('[instagram/hashtag] 专用 Scraper 失败，回退到通用 Scraper:', e?.message)
                // 回退到通用 scraper
                run = await client.actor(APIFY_IG_ACTOR).call(input)
                const result = await client.dataset(run.defaultDatasetId).listItems()
                items = result.items
                console.log('[instagram/fallback] 通用 Scraper 返回数据量:', items?.length || 0)
            }
        } else {
            // profile 类型：直接使用通用 scraper
            console.log('[instagram/profile] 调用通用 Scraper，输入:', JSON.stringify(input, null, 2))
            run = await client.actor(APIFY_IG_ACTOR).call(input)
            const result = await client.dataset(run.defaultDatasetId).listItems()
            items = result.items
            console.log('[instagram/profile] 通用 Scraper 返回数据量:', items?.length || 0)
        }

        // 数据标准化
        const normalized = normalizeInstagram(Array.isArray(items) ? items : [items], keywords)
        console.log('[instagram] 标准化后数据量:', normalized.length)
        console.log('[instagram] 前3条标准化数据:', JSON.stringify(normalized.slice(0, 3), null, 2))

        // 评分裁切
        const scored = rankAndSlice(normalized, Number(limit))

        // 保存到数据库
        const saved = await saveInstagramPosts(scored, rid)
        console.log('[instagram] 已保存到数据库:', saved, '条')

        return res.json({ items: scored, saved, runId: rid })
    } catch (e) {
        console.error('[instagram] 搜索异常:', e)
        return res.status(500).json({ error: 'Instagram 搜索失败', detail: String(e?.message || e) })
    }
})

// 一步到位：触发并同步下载（Apify Actor），用于快速连通性测试
app.post('/api/sourcing/tiktok/instant', async (req, res) => {
    try {
        const { keywords = [], count = 20, runId = '' } = req.body || {}
        const rid = String(runId || `${Date.now()}-tiktok`)
        if (runId) {
            await createSourcingRun({ id: rid, platforms: ['tiktok'], keywords, count })
        }
        if (!Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({ error: 'keywords 不能为空' })
        }
        if (!APIFY_TOKEN) return res.status(500).json({ error: '缺少 APIFY_TOKEN 环境变量' })

        const client = new ApifyClient({ token: APIFY_TOKEN })
        // 工具：将原始数据转换为统一结构
        const toIso = (rawTime) => {
            if (!rawTime) return null
            try {
                if (typeof rawTime === 'number' || (typeof rawTime === 'string' && /^\d+$/.test(rawTime))) {
                    const ts = Number(rawTime)
                    const ms = ts.toString().length === 10 ? ts * 1000 : ts
                    return new Date(ms).toISOString()
                }
                return new Date(rawTime).toISOString()
            } catch {
                return null
            }
        }
        const mapItems = (arr, kw) => (Array.isArray(arr) ? arr : [arr]).map((it) => ({
            postId: (it && it.id) ? `tiktok:${it.id}` : undefined,
            platform: 'tiktok',
            keyword: kw || (it?.input) || (it?.searchHashtag?.name) || '',
            author: it?.authorMeta?.uniqueId || it?.authorMeta?.name || it?.profile_username || it?.author_name || it?.username || it?.author || it?.account_id || '',
            url: it?.webVideoUrl || it?.url || it?.share_url || it?.tiktokLink || '',
            title: String(it?.text || it?.title || it?.description || it?.desc || '').slice(0, 120),
            desc: it?.text || it?.description || it?.desc || it?.caption || '',
            published_at: toIso(it?.createTime || it?.createTimeISO || it?.create_time || it?.timestamp || it?.published_at),
            likes: it?.diggCount || it?.digg_count || it?.like_count || it?.likes || 0,
            comments: it?.commentCount || it?.comment_count || it?.comments || 0,
            shares: it?.shareCount || it?.share_count || it?.shares || 0,
            views: it?.playCount || it?.play_count || it?.views || 0,
            followers: it?.authorMeta?.followerCount || it?.profile_followers || it?.author_followers || it?.followers || 0,
            fetched_at: new Date().toISOString(),
            raw_data: it
        }))

        // —— 逐个关键词抓取：每个关键词各自 limit=count ——
        const kwList = keywords.map(k => String(k).trim()).filter(Boolean)
        const perKwLimit = Math.max(1, Number(count) || 20)
        const allMapped = []
        for (const kw of kwList) {
            const input = {
                // 按 Actor 正确输入规范
                searchQueries: [String(kw)],
                resultsPerPage: perKwLimit,
                excludePinnedPosts: false,
                proxyCountryCode: 'None',
                scrapeRelatedVideos: false,
                shouldDownloadVideos: false,
                shouldDownloadCovers: false,
                shouldDownloadSubtitles: false,
                shouldDownloadSlideshowImages: false,
                shouldDownloadAvatars: false,
                shouldDownloadMusicCovers: false,
                profileScrapeSections: ['videos'],
                profileSorting: 'latest',
                searchSection: '',
                maxProfilesPerQuery: 10
            }
            console.log('[tiktok] 调用 Apify Actor（逐关键词）输入:', JSON.stringify(input, null, 2))
            // 直接等待运行完成，避免数据集尚未填充只拿到 1 条
            const run = await client.actor(APIFY_TT_ACTOR).call(input)
            const ds = client.dataset(run.defaultDatasetId)
            // 读取数据集，limit 设为期望条数的 2 倍，确保充足
            let items = []
            try {
                const resp = await ds.listItems({ clean: true, limit: perKwLimit * 2 })
                items = Array.isArray(resp.items) ? resp.items : []
            } catch { items = [] }
            // 若仍不足，短轮询补一次
            if (items.length < perKwLimit) {
                await new Promise(r => setTimeout(r, 1500))
                try {
                    const resp2 = await ds.listItems({ clean: true, limit: perKwLimit * 2 })
                    items = Array.isArray(resp2.items) ? resp2.items : items
                } catch { }
            }
            console.log(`[tiktok] 关键词 "${kw}" 返回原始数量:`, items.length)
            const mapped = mapItems(items, kw)
            console.log(`[tiktok] 关键词 "${kw}" 映射后数量:`, mapped.length)
            allMapped.push(...mapped)
        }

        await saveTikTokPosts(allMapped, rid)
        return res.json({ items: allMapped, rawCount: allMapped.length, runId: rid })
    } catch (e) {
        console.error(e)
        return res.status(500).json({ error: 'instant 异常' })
    }
})

// 触发 YouTube 任务（关键词发现）
app.post('/api/sourcing/youtube/trigger', async (req, res) => {
    try {
        const { keywords = [], count = 20, start_date = '', end_date = '', country = '', runId = '' } = req.body || {}
        const rid = String(runId || `${Date.now()}-youtube`)
        await createSourcingRun({ id: rid, platforms: ['youtube'], keywords, count })
        if (!Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({ error: 'keywords 不能为空' })
        }

        // Bright Data YouTube Posts API：discover_by=keyword
        // 每个关键词映射为一个输入对象
        const payload = keywords.map(k => ({
            keyword: k,
            num_of_posts: String(count),
            start_date, // mm-dd-yyyy，可为空
            end_date,
            country
        }))
        const url = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${DATASET_ID_YOUTUBE}&include_errors=true&type=discover_new&discover_by=keyword`
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })
        const text = await r.text()
        if (!r.ok) {
            return res.status(500).json({ error: `trigger失败: ${r.status} ${text}` })
        }
        // 统一异步返回，供前端轮询或使用 latest
        let snapshotId
        try {
            const data = JSON.parse(text)
            snapshotId = data?.snapshot_id
        } catch { }
        const jobId = `${Date.now()}`
        jobs.set(jobId, { keywords, startedAt: Date.now(), snapshotId })
        return res.json({ jobId, snapshotId, mode: 'async', runId: rid })
    } catch (e) {
        console.error(e)
        return res.status(500).json({ error: 'YouTube 触发异常' })
    }
})

// 拉取 YouTube 结果（读取最新 ready 快照）
app.get('/api/sourcing/youtube/results', async (req, res) => {
    try {
        const { jobId, count = '20', runId = '' } = req.query
        const headers = { 'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}` }
        const limit = Math.max(1, Number(count) || 20)

        const toJsonSafe = async (resp) => { try { return await resp.json() } catch { return {} } }

        // 分支1：Marketplace request_id（j_ 开头）
        if (jobId && /^j_/i.test(String(jobId))) {
            const statusUrl = `https://api.brightdata.com/datasets/request_collection?request_id=${encodeURIComponent(String(jobId))}`
            const s = await fetch(statusUrl, { headers })
            if (!s.ok) {
                const errTxt = await s.text().catch(() => '')
                return res.status(502).json({ error: `request_id 查询失败(${s.status})`, detail: errTxt })
            }
            const sJson = await toJsonSafe(s)
            const status = String(sJson.status || '').toLowerCase()
            const viewId = sJson.view_id || ''
            const datasetId = sJson.dataset_id || DATASET_ID_YOUTUBE
            if (status && status !== 'done') {
                return res.json({ status, message: '采集中，请稍后重试' })
            }
            if (!viewId) {
                return res.status(500).json({ error: 'request_id 已完成，但缺少 view_id' })
            }
            // 依次尝试多种 view 拉取端点（不带 dataset_id）
            const tryUrls = [
                `https://api.brightdata.com/datasets/v3/view/${encodeURIComponent(String(viewId))}/items?format=json`,
                `https://api.brightdata.com/datasets/view/${encodeURIComponent(String(viewId))}/items?format=json`
            ]
            let data = null
            for (const u of tryUrls) {
                const r = await fetch(u, { headers })
                if (!r.ok) continue
                const j = await toJsonSafe(r)
                if (Array.isArray(j) || Array.isArray(j?.data)) { data = j; break }
            }
            if (!data) return res.json({ items: [], rawCount: 0, saved: 0, status: 'done', runId: String(runId || '') })
            const items = Array.isArray(data) ? data : (data.data || [])
            const normalizedAll = normalizeYouTube(items, [])
            // 入库全部
            const saved = await saveYouTubePosts(normalizedAll, String(runId || ''))
            // 仅返回前 count 条以便前端渲染
            const scored = rankAndSlice(normalizedAll, limit)
            return res.json({ items: scored, rawCount: items.length, saved, status: 'done', runId: String(runId || '') })
        }

        // 分支2：snapshotId（s_ 开头）或本地 jobId 或 latest
        let snapshotKey = 'latest'
        let keywordsForFilter = []
        if (jobId && String(jobId).toLowerCase() !== 'latest') {
            if (/^s_/i.test(String(jobId))) {
                snapshotKey = String(jobId)
                keywordsForFilter = []
            } else {
                const job = jobs.get(String(jobId))
                if (job) {
                    snapshotKey = job.snapshotId || 'latest'
                    keywordsForFilter = Array.isArray(job.keywords) ? job.keywords : []
                }
            }
        }

        // 修复：v3 snapshot 端点不允许 dataset_id 参数
        const snapshotUrls = [
            `https://api.brightdata.com/datasets/v3/snapshot/${snapshotKey}?format=json`
        ]
        let items = []
        for (const u of snapshotUrls) {
            // 简短轮询：若 202 未就绪，最多等 3 次、每次 3 秒
            let tries = 0
            let got = null
            while (tries < 3) {
                tries++
                const r = await fetch(u, { headers })
                if (r.status === 202) { await new Promise(r => setTimeout(r, 3000)); continue }
                if (!r.ok) { break }
                const j = await r.json().catch(() => ({}))
                got = Array.isArray(j) ? j : (j?.data || [])
                break
            }
            if (Array.isArray(got) && got.length >= 0) { items = got; break }
        }
        const normalizedAll = normalizeYouTube(items, keywordsForFilter)
        // 入库全部
        const saved = await saveYouTubePosts(normalizedAll, String(runId || ''))
        // 仅返回前 count 条
        const scored = rankAndSlice(normalizedAll, limit)
        return res.json({ items: scored, rawCount: items.length, saved, runId: String(runId || '') })
    } catch (e) {
        console.error(e)
        return res.status(500).json({ error: 'YouTube latest 异常' })
    }
})

// 列出 YouTube 数据集的全部快照，供前端选择
app.get('/api/sourcing/youtube/snapshots', async (req, res) => {
    try {
        // 优先使用 v3 端点；失败时回退到无版本前缀
        const tryUrls = [
            `https://api.brightdata.com/datasets/v3/snapshots?dataset_id=${DATASET_ID_YOUTUBE}`,
            `https://api.brightdata.com/datasets/snapshots?dataset_id=${DATASET_ID_YOUTUBE}`
        ]
        let data = null
        for (const u of tryUrls) {
            const r = await fetch(u, { headers: { 'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}` } })
            if (r.ok) {
                try { data = await r.json() } catch { data = null }
                if (Array.isArray(data)) break
            }
        }
        if (!Array.isArray(data)) return res.json({ items: [] })

        // 统一字段
        const items = data.map(it => ({
            id: it.id || it.snapshot_id || it._id || '',
            created: it.created || it.created_at || it.timestamp || '',
            status: it.status || it.state || '',
            dataset_id: it.dataset_id || DATASET_ID_YOUTUBE,
            view_id: it.view_id || it.view || '',
            size: it.dataset_size || it.size || undefined
        })).filter(x => x.id)

        // 按时间倒序
        items.sort((a, b) => String(b.created).localeCompare(String(a.created)))
        return res.json({ items })
    } catch (e) {
        console.error('[snapshots] 列表异常:', e)
        return res.status(500).json({ error: '快照列表获取失败' })
    }
})

// —— 新增：飞书多维表（Bitable）与云盘上传 ——
let LARK_TOKEN_CACHE = { token: '', expireAt: 0 }
async function getLarkTenantToken() {
    try {
        const now = Date.now()
        if (LARK_TOKEN_CACHE.token && LARK_TOKEN_CACHE.expireAt - now > 60 * 1000) {
            return LARK_TOKEN_CACHE.token
        }
        if (!LARK_APP_ID || !LARK_APP_SECRET) throw new Error('缺少 LARK_APP_ID / LARK_APP_SECRET')
        const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET })
        })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || !data.tenant_access_token) {
            throw new Error(data?.msg || '获取 tenant_access_token 失败')
        }
        LARK_TOKEN_CACHE = {
            token: data.tenant_access_token,
            // token 通常 2 小时过期，这里保守设置 1 小时 50 分钟
            expireAt: Date.now() + 110 * 60 * 1000
        }
        return LARK_TOKEN_CACHE.token
    } catch (e) {
        console.error('[lark] 获取 token 失败:', e)
        throw e
    }
}

// 缓存表字段元数据，减少频繁请求
let LARK_FIELDS_CACHE = { items: null, expireAt: 0 }
async function getLarkTableFieldsMeta() {
    const now = Date.now()
    if (LARK_FIELDS_CACHE.items && LARK_FIELDS_CACHE.expireAt - now > 60 * 1000) {
        return LARK_FIELDS_CACHE.items
    }
    const token = await getLarkTenantToken()
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(LARK_APP_TOKEN)}/tables/${encodeURIComponent(LARK_TABLE_ID)}/fields`
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || data?.code) throw new Error(data?.msg || '读取字段元数据失败')
    const items = (data?.data?.items || data?.data || data?.items || []).map((f) => ({
        id: f.field_id || f.id,
        name: f.field_name || f.name,
        // 同存两份：字符串与数字型，便于判断
        type: String(f.type || f.field_type || '').toLowerCase(),
        typeNum: Number(f.type || f.field_type),
        options: ((f.property && (f.property.options || f.property.option || [])) || []).map((o) => ({ id: o.id, name: o.name })),
        prop: f.property || {}
    }))
    LARK_FIELDS_CACHE = { items, expireAt: Date.now() + 5 * 60 * 1000 }
    return items
}

// 直接以“字段名称”为键构造 fields，并按官方写入规范转换值
function toLarkFieldValueByName(fieldName, value, meta) {
    if (!meta) return undefined
    const t = String(meta.type).toLowerCase()
    const isText = (t.includes('text') || t === 'paragraph' || t === 'markdown' || t === 'md' || t === 'textarea' || t === 'multi_line_text' || t === 'textv2')
    if (isText) return typeof value === 'string' ? value : (value && typeof value === 'object' && value.text ? String(value.text) : String(value ?? ''))
    if (t === 'number' || t === 'int' || t === 'float') return Number(value)
    if (t === 'single_select' || t === 'singleselect') {
        const candidate = typeof value === 'string' ? value : (value && value.name ? value.name : '')
        const hit = (meta.options || []).find(o => String(o.name || '').toLowerCase() === String(candidate).toLowerCase())
        return hit ? hit.name : undefined
    }
    if (t === 'multi_select' || t === 'multiselect') {
        const arr = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : [])
        const names = arr.map(v => typeof v === 'string' ? v : (v && v.name ? v.name : '')).filter(Boolean)
        const valid = names
            .map(n => (meta.options || []).find(o => String(o.name || '').toLowerCase() === String(n).toLowerCase())?.name)
            .filter(Boolean)
        return valid.length > 0 ? valid : undefined
    }
    if (t === 'url' || t === 'urlv2' || t === 'link') {
        if (typeof value === 'string') return { text: value, link: value }
        if (value && typeof value === 'object') {
            const link = String(value.link || value.url || '')
            const text = String(value.text || link || '')
            return link ? { text, link } : undefined
        }
        return undefined
    }
    if (t === 'checkbox' || t === 'bool' || t === 'boolean') return Boolean(value)
    // 其他不识别类型：尽量转字符串
    return typeof value === 'string' ? value : String(value ?? '')
}

// 根据表结构校验与清洗字段值，避免 field validation 报错
function normalizeFieldName(s) {
    return String(s || '').toLowerCase().replace(/[\s_\-（）()\[\]{}:：]/g, '')
}

const FIELD_ALIASES = {
    title: ['title', '标题'],
    slug: ['slug', '别名', '短链'],
    description: ['description', '描述', '简介'],
    usage_guide: ['usage_guide', 'usageguide', 'usage guide', '使用指南', '使用说明', 'howtouse'],
    like: ['like', '点赞', '热度'],
    title_cn: ['title_cn', 'titlecn', '中文标题', '标题中文'],
    description_cn: ['description_cn', 'descriptioncn', '中文描述', '描述中文'],
    usage_guide_cn: ['usage_guide_cn', 'usageguidecn', '中文使用指南', '如何使用', 'howtouse中文'],
    type: ['type', '类型'],
    category: ['category', '分类', '类别'],
    status: ['status', '状态'],
    cover: ['cover', '封面', '封面链接', '封面url'],
    example_output: ['example_output', '示例输出', '样例输出']
}

async function sanitizeLarkFields(raw) {
    try {
        const fieldsMeta = await getLarkTableFieldsMeta().catch(() => [])
        if (!Array.isArray(fieldsMeta) || fieldsMeta.length === 0) return raw
        const nameToMeta = new Map()
        for (const f of fieldsMeta) {
            nameToMeta.set(String(f.name), f)
            nameToMeta.set(normalizeFieldName(f.name), f)
        }
        const result = {}
        for (const [name, val] of Object.entries(raw || {})) {
            let meta = nameToMeta.get(String(name)) || nameToMeta.get(normalizeFieldName(name))
            // 使用别名匹配（兼容不同表头命名）
            if (!meta) {
                const n = normalizeFieldName(name)
                for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
                    if (aliases.map(normalizeFieldName).includes(n)) {
                        // 在表字段中查找与 canonical 对应的字段
                        for (const [k, v] of nameToMeta.entries()) {
                            if (normalizeFieldName(k) === canonical) { meta = v; break }
                        }
                        break
                    }
                }
            }
            if (!meta) continue // 表里没有该字段，忽略
            const t = meta.type
            const canonicalName = normalizeFieldName(meta.name)
            // 强制规则：Status/Type/Category 按选项字段处理，若不匹配则跳过
            if (canonicalName === 'status' || canonicalName === 'type') {
                const candidate = typeof val === 'string' ? val : (val && typeof val === 'object' && val.name ? val.name : undefined)
                if (candidate && Array.isArray(meta.options) && meta.options.length > 0) {
                    const ok = meta.options.find(o => String(o.name || '').toLowerCase() === String(candidate).toLowerCase())
                    if (ok) result[meta.id] = { name: ok.name }
                }
                continue
            }
            if (canonicalName === 'category') {
                const arr = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',').map(s => s.trim()).filter(Boolean) : [])
                const names = arr.map(v => typeof v === 'string' ? v : (v && v.name ? v.name : '')).filter(Boolean)
                if (Array.isArray(meta.options) && meta.options.length > 0) {
                    const valid = names
                        .map(n => (meta.options || []).find(o => String(o.name || '').toLowerCase() === String(n).toLowerCase())?.name)
                        .filter(Boolean)
                    if (valid.length > 0) result[meta.id] = valid.map(n => ({ name: n }))
                }
                continue
            }
            // 归一处理常见类型（按字段ID回填）
            const isText = (
                t === 'text' || t === 'rich_text' || t === 'long_text' || t === 'paragraph' ||
                t === 'markdown' || t === 'md' || t === 'textarea' || t === 'multi_line_text' || t === 'textv2'
            )
            if (isText) {
                if (typeof val === 'string') result[meta.id] = val
                else if (val && typeof val === 'object' && typeof val.text === 'string') result[meta.id] = val.text
                else result[meta.id] = String(val)
                continue
            }
            if (t === 'url' || t === 'urlv2' || t === 'link') {
                // URL：按 {link, text} 传值最稳妥
                if (typeof val === 'string') result[meta.id] = { link: val, text: val }
                else if (val && typeof val === 'object' && (val.link || val.url || val.text)) {
                    const link = String(val.link || val.url || '')
                    const text = String(val.text || link || '')
                    result[meta.id] = { link, text }
                }
                continue
            }
            if (t === 'number' || t === 'int' || t === 'float') {
                const num = Number(val)
                if (!Number.isNaN(num)) result[meta.id] = num
                continue
            }
            if (t === 'single_select' || t === 'singleselect') {
                const candidate = typeof val === 'string' ? val : (val && typeof val === 'object' && val.name ? val.name : undefined)
                if (candidate) {
                    const candLower = String(candidate).toLowerCase()
                    const ok = (meta.options || []).find(o => String(o.name || '').toLowerCase() === candLower)
                    if (ok) {
                        // 飞书单选字段允许传 { name } 或 选项ID，这里统一传 { name }
                        result[meta.id] = { name: ok.name }
                    }
                }
                continue
            }
            if (t === 'multi_select' || t === 'multiselect') {
                const arr = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',').map(s => s.trim()).filter(Boolean) : [])
                const names = arr.map(v => typeof v === 'string' ? v : (v && v.name ? v.name : '')).filter(Boolean)
                const validIds = names
                    .map(n => {
                        const hit = (meta.options || []).find(o => String(o.name || '').toLowerCase() === String(n).toLowerCase())
                        return hit ? (hit.id || hit.name) : undefined
                    })
                    .filter(Boolean)
                if (validIds.length > 0) {
                    // 多选字段统一传 [{ name }]
                    const validNames = names.filter(n => (meta.options || []).some(o => String(o.name || '').toLowerCase() === String(n).toLowerCase()))
                    result[meta.id] = validNames.map(n => ({ name: (meta.options || []).find(o => String(o.name || '').toLowerCase() === String(n).toLowerCase())?.name || n }))
                }
                continue
            }
            if (t === 'checkbox' || t === 'bool' || t === 'boolean') {
                result[meta.id] = Boolean(val)
                continue
            }
            // 其他未知类型：
            // 若存在 options 列表，则按单选/多选兜底处理；否则尝试原值
            if (Array.isArray(meta.options) && meta.options.length > 0) {
                const isMulti = Boolean(meta.prop?.multiple)
                if (isMulti) {
                    const arr = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',').map(s => s.trim()).filter(Boolean) : [])
                    const names = arr.map(v => typeof v === 'string' ? v : (v && v.name ? v.name : '')).filter(Boolean)
                    const valid = names
                        .map(n => (meta.options || []).find(o => String(o.name || '').toLowerCase() === String(n).toLowerCase())?.name)
                        .filter(Boolean)
                    if (valid.length > 0) { result[meta.id] = valid.map(n => ({ name: n })) }
                } else {
                    const candidate = typeof val === 'string' ? val : (val && typeof val === 'object' && val.name ? val.name : undefined)
                    if (candidate) {
                        const ok = (meta.options || []).find(o => String(o.name || '').toLowerCase() === String(candidate).toLowerCase())
                        if (ok) { result[meta.id] = { name: ok.name } }
                    }
                }
            } else {
                result[meta.id] = val
            }
        }
        // 兜底：若没有任何匹配字段，但表中存在文本字段，则至少写入第一个文本字段为 Title
        if (Object.keys(result).length === 0) {
            const textField = fieldsMeta.find(f => String(f.type).toLowerCase().includes('text'))
            if (textField && raw.Title) {
                result[textField.id] = String(raw.Title)
            }
        }
        return result
    } catch {
        return raw
    }
}

// 创建 Bitable 记录（使用“字段名称”为键，严格遵守官方写入格式）
app.post('/api/lark/bitable/record', async (req, res) => {
    try {
        const { record = {} } = req.body || {}
        if (!LARK_APP_TOKEN || !LARK_TABLE_ID) {
            return res.status(400).json({ error: '缺少 LARK_APP_TOKEN 或 LARK_TABLE_ID 配置' })
        }
        const token = await getLarkTenantToken()

        // 以字段“名称”为键直接构造 payload（不再用 field_id），并做必要格式转换
        const input = { ...(record || {}) }
        if (!('Status' in input)) input['Status'] = 'draft'

        const toString = (v) => v == null ? '' : (typeof v === 'string' ? v : String(v))
        const toNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined }
        const toUrlObj = (v) => {
            if (!v) return undefined
            if (typeof v === 'string') return { text: v, link: v }
            if (typeof v === 'object') {
                const link = String(v.link || v.url || '')
                const text = String(v.text || link || '')
                return link ? { text, link } : undefined
            }
            return undefined
        }
        const toStringArray = (v) => Array.isArray(v)
            ? v.map(x => typeof x === 'string' ? x : (x && x.name ? x.name : String(x))).filter(Boolean)
            : (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined)

        // 获取字段元数据用于选项校验
        const metas = await getLarkTableFieldsMeta().catch(() => [])
        const metaByName = new Map(metas.map(m => [String(m.name), m]))
        const norm = (s) => String(s || '').toLowerCase()

        const fields = {}
        if ('Title' in input) fields['Title'] = toString(input.Title)
        if ('Slug' in input) fields['Slug'] = toString(input.Slug)
        if ('Description' in input) fields['Description'] = toString(input.Description)
        if ('Usage_Guide' in input) fields['Usage_Guide'] = toString(input.Usage_Guide)
        if ('Like' in input) { const n = toNumber(input.Like); if (n !== undefined) fields['Like'] = n }
        if ('Title_CN' in input) fields['Title_CN'] = toString(input.Title_CN)
        if ('Description_CN' in input) fields['Description_CN'] = toString(input.Description_CN)
        if ('Usage_Guide_CN' in input) fields['Usage_Guide_CN'] = toString(input.Usage_Guide_CN)
        // 单选：仅当选项存在时写入
        if ('Type' in input) {
            const meta = metaByName.get('Type')
            const val = toString(input.Type)
            const ok = meta && Array.isArray(meta.options) && meta.options.some(o => norm(o.name) === norm(val))
            if (ok) fields['Type'] = val
        }
        if ('Status' in input) {
            const meta = metaByName.get('Status')
            const val = toString(input.Status)
            const ok = meta && Array.isArray(meta.options) && meta.options.some(o => norm(o.name) === norm(val))
            if (ok) fields['Status'] = val
        }
        // 多选：过滤非法选项
        if ('Category' in input) {
            const meta = metaByName.get('Category')
            const arr = toStringArray(input.Category) || []
            const valid = meta && Array.isArray(meta.options)
                ? arr.filter(x => meta.options.some(o => norm(o.name) === norm(x)))
                : []
            if (valid.length > 0) fields['Category'] = valid
        }
        if ('Cover' in input) { const u = toUrlObj(input.Cover); if (u) fields['Cover'] = u }
        if ('Example_Output' in input) fields['Example_Output'] = toString(input.Example_Output)

        const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(LARK_APP_TOKEN)}/tables/${encodeURIComponent(LARK_TABLE_ID)}/records`
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
        })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data?.code) {
            const violations = data?.error?.field_violations || []
            console.error('[lark/bitable/record] 请求失败:', { status: r.status, data, fields, violations })
            return res.status(500).json({ error: data?.msg || '创建多维表格记录失败', detail: data, fields, violations })
        }
        return res.json({ ok: true, data })
    } catch (e) {
        console.error('[lark/bitable/record] 失败:', e)
        return res.status(500).json({ error: '创建多维表格记录失败', detail: String(e?.message || e) })
    }
})

// 上传文本为飞书云盘文件，返回 file_token
app.post('/api/lark/drive/upload_text', async (req, res) => {
    try {
        const { filename = 'content.md', content = '', mime = 'text/markdown' } = req.body || {}
        const token = await getLarkTenantToken()

        const form = new FormData()
        form.append('file_name', filename)
        form.append('parent_type', 'explorer')
        form.append('parent_node', '0')
        form.append('size', Buffer.byteLength(content))
        form.append('file', Buffer.from(String(content)), { filename, contentType: mime })

        const r = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_all', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: form
        })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data?.code) {
            return res.status(500).json({ error: data?.msg || '飞书附件上传失败', detail: data })
        }
        const fileToken = data?.data?.file?.token || data?.data?.file_token
        return res.json({ ok: true, file_token: fileToken })
    } catch (e) {
        console.error('[lark/drive/upload_text] 失败:', e)
        return res.status(500).json({ error: '飞书附件上传失败', detail: String(e?.message || e) })
    }
})

// —— 新增：内容保存与读取接口（前端调用 /api/content/save 与 /api/content/list） ——
app.post('/api/content/save', async (req, res) => {
    try {
        const body = req.body || {}

        // 兼容字段命名：从前端映射结构提取
        const id = String(body.Record_ID || hashOf('content', String(body.Title || ''), String(body.Slug || '')))
        const title = String(body.Title || '')
        const slug = body.Slug ? String(body.Slug) : null
        const description = String(body.Description || '')
        const category = String(body.Category || '')
        const type = String(body.Type || '')
        const usage_guide = String(body.Usage_Guide || '')
        const like = Number.isFinite(body.like) ? Number(body.like) : 0
        const status = String(body.status || 'draft')
        const title_cn = String(body.Title_CN || '')
        const description_cn = String(body.Description_CN || '')
        const usage_guide_cn = String(body.Usage_Guide_CN || '')
        // Cover：取首个字符串；Example_Output：逗号拼接
        const cover = Array.isArray(body.Cover)
            ? (body.Cover.find((s) => typeof s === 'string' && s.trim()) || null)
            : (typeof body.Cover === 'string' ? body.Cover : null)
        const example_output = Array.isArray(body.Example_Output)
            ? body.Example_Output.filter((s) => typeof s === 'string' && s.trim()).join(',') || null
            : (typeof body.Example_Output === 'string' ? body.Example_Output : null)

        if (!title) return res.status(400).json({ error: 'Title 不能为空' })

        // UPSERT 到 PostgreSQL
        await pgPool.query(`
            INSERT INTO contents (id, title, slug, description, category, type, usage_guide, "like", status, title_cn, description_cn, usage_guide_cn, cover, example_output, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                slug = COALESCE(EXCLUDED.slug, contents.slug),
                description = EXCLUDED.description,
                category = EXCLUDED.category,
                type = EXCLUDED.type,
                usage_guide = EXCLUDED.usage_guide,
                "like" = COALESCE(EXCLUDED."like", contents."like"),
                status = COALESCE(EXCLUDED.status, contents.status),
                title_cn = EXCLUDED.title_cn,
                description_cn = EXCLUDED.description_cn,
                usage_guide_cn = EXCLUDED.usage_guide_cn,
                cover = COALESCE(EXCLUDED.cover, contents.cover),
                example_output = COALESCE(EXCLUDED.example_output, contents.example_output),
                updated_at = now();
        `, [
            id, title, slug, description, category, type, usage_guide, like, status,
            title_cn, description_cn, usage_guide_cn, cover, example_output
        ])

        return res.json({ ok: true, id })
    } catch (e) {
        console.error('[content/save] 保存失败:', e)
        return res.status(500).json({ error: '保存失败', detail: String(e?.message || e) })
    }
})

app.get('/api/content/list', async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100))
        const result = await pgPool.query(
            `SELECT id, title, slug, description, category, type, usage_guide, "like", status, title_cn, description_cn, usage_guide_cn, cover, example_output, created_at, updated_at
             FROM contents
             ORDER BY updated_at DESC NULLS LAST
             LIMIT $1`,
            [limit]
        )
        return res.json({ items: result.rows || [] })
    } catch (e) {
        console.error('[content/list] 查询失败:', e)
        return res.status(500).json({ error: '读取失败', detail: String(e?.message || e) })
    }
})

// 获取单条内容记录：支持通过 recordId(id)、title 或 slug 查询
app.get('/api/content/one', async (req, res) => {
    try {
        const { recordId = '', title = '', slug = '' } = req.query
        let row = null
        if (recordId) {
            const r = await pgPool.query(
                `SELECT * FROM contents WHERE id = $1 LIMIT 1`,
                [String(recordId)]
            )
            row = r.rows?.[0] || null
        }
        if (!row && title) {
            const r = await pgPool.query(
                `SELECT * FROM contents WHERE title = $1 LIMIT 1`,
                [String(title)]
            )
            row = r.rows?.[0] || null
        }
        if (!row && slug) {
            const r = await pgPool.query(
                `SELECT * FROM contents WHERE slug = $1 LIMIT 1`,
                [String(slug)]
            )
            row = r.rows?.[0] || null
        }
        if (!row) return res.status(404).json({ error: 'not found' })
        return res.json({ item: row })
    } catch (e) {
        console.error('[content/one] 查询失败:', e)
        return res.status(500).json({ error: '读取失败', detail: String(e?.message || e) })
    }
})

// —— 新增：URL内容获取代理（解决前端CORS问题） ——
app.post('/api/content/fetch-url', async (req, res) => {
    try {
        const { url } = req.body || {}
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'URL参数必填' })
        }

        // 基础URL验证
        let targetUrl
        try {
            targetUrl = new URL(url)
        } catch (e) {
            return res.status(400).json({ error: '无效的URL格式' })
        }

        // 安全检查：仅允许HTTP/HTTPS协议
        if (!['http:', 'https:'].includes(targetUrl.protocol)) {
            return res.status(400).json({ error: '仅支持HTTP/HTTPS协议' })
        }

        // 允许的主机名白名单（可选）：ALLOWED_FETCH_HOSTS=example.com,another.com
        const allowHosts = (process.env.ALLOWED_FETCH_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)
        if (allowHosts.length > 0 && !allowHosts.includes(targetUrl.hostname)) {
            return res.status(403).json({ error: '目标域名不在允许列表中' })
        }

        console.log('[fetch-url] 正在获取URL内容:', url)

        // 超时控制：AbortController 替代 node-fetch v3 已移除的 timeout
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 30000)
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            },
            agent: PICK_AGENT(url),
            signal: controller.signal
        }).finally(() => clearTimeout(timer))

        if (!response.ok) {
            return res.status(response.status).json({
                error: `URL获取失败: ${response.status} ${response.statusText}`
            })
        }

        const contentType = response.headers.get('content-type') || ''

        // 确保是文本内容
        if (!contentType.includes('text/') && !contentType.includes('application/xml') && !contentType.includes('application/json')) {
            return res.status(400).json({
                error: '不支持的内容类型，仅支持文本内容'
            })
        }

        // 限制响应体大小 2MB，防止 OOM
        const MAX_BYTES = 2 * 1024 * 1024
        const reader = response.body?.getReader?.()
        if (reader) {
            let received = 0
            let chunks = []
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                received += value.byteLength
                if (received > MAX_BYTES) {
                    return res.status(413).json({ error: '内容过大，超过 2MB 限制' })
                }
                chunks.push(Buffer.from(value))
            }
            const content = Buffer.concat(chunks).toString('utf-8')
            return res.json({ success: true, content, contentType, url })
        }

        const content = await response.text()

        return res.json({
            success: true,
            content: content,
            contentType: contentType,
            url: url
        })

    } catch (error) {
        console.error('[fetch-url] 获取URL失败:', error)

        // 区分不同错误类型
        let errorMessage = '获取URL内容失败'
        if (error.name === 'AbortError') {
            return res.status(504).json({ error: '请求超时' })
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = 'DNS解析失败，请检查URL是否正确'
        } else if (error.code === 'ECONNREFUSED') {
            errorMessage = '连接被拒绝，目标服务器可能不可用'
        } else if (error.code === 'ETIMEDOUT') {
            errorMessage = '请求超时，请稍后重试'
        } else if (error.message) {
            errorMessage = error.message
        }

        return res.status(500).json({
            error: errorMessage,
            detail: error.code || 'UNKNOWN_ERROR'
        })
    }
})

// 按快照ID拉取数据并标准化、可选入库
app.get('/api/sourcing/youtube/snapshots/:snapshotId/items', async (req, res) => {
    try {
        const { snapshotId } = req.params
        const { count = '50', runId = '', save = 'false' } = req.query
        if (!snapshotId) return res.status(400).json({ error: 'snapshotId 必填' })

        const buildUrl = (sid) => `https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(String(sid))}?format=json`
        const headers = { 'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}` }

        // 处理 202（未就绪）与临时错误的短轮询（最多 6 次，每次 5s）
        let attempts = 0
        let lastErrTxt = ''
        let items = []
        while (attempts < 6) {
            attempts++
            const r = await fetch(buildUrl(snapshotId), { headers })
            if (r.status === 202) {
                // 快照尚未准备就绪，等待后重试
                await new Promise(r => setTimeout(r, 5000))
                continue
            }
            if (!r.ok) {
                try { lastErrTxt = await r.text() } catch { lastErrTxt = '' }
                // 4xx/5xx 直接失败（除了 429 可短暂重试一次）
                if (r.status === 429 && attempts < 6) {
                    await new Promise(r => setTimeout(r, 5000))
                    continue
                }
                return res.status(500).json({ error: `读取快照失败(${r.status})`, detail: lastErrTxt })
            }
            // 尝试解析数据
            let json
            try { json = await r.json() } catch { json = [] }
            items = Array.isArray(json) ? json : (json?.data || [])
            break
        }

        if (!Array.isArray(items)) items = []
        const normalized = normalizeYouTube(items, [])
        const sliced = rankAndSlice(normalized, Number(count))
        if (String(save).toLowerCase() === 'true') {
            try { await saveYouTubePosts(sliced, String(runId || '')) } catch { /* 忽略入库失败 */ }
        }
        return res.json({ items: sliced, rawCount: items.length, runId: String(runId || '') })
    } catch (e) {
        console.error('[snapshot-items] 异常:', e)
        return res.status(500).json({ error: '快照数据获取失败', detail: String(e?.message || e) })
    }
})

// 将用户在前端选择的条目批量入库
app.post('/api/sourcing/youtube/save', async (req, res) => {
    try {
        const { items = [], runId = '' } = req.body || {}
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items 不能为空' })
        }
        // 要求 items 为 normalizeYouTube 格式；后续可在此处补充必要字段的校验/兜底
        const saved = await saveYouTubePosts(items, String(runId || ''))
        return res.json({ ok: true, saved })
    } catch (e) {
        console.error('[youtube/save] 入库失败:', e)
        return res.status(500).json({ error: '入库失败', detail: String(e?.message || e) })
    }
})

// 直接获取数据库内最新的帖子记录（无需外部请求）
app.get('/api/sourcing/latest', async (req, res) => {
    try {
        const { platform = 'all', count = 50, runId = '' } = req.query
        const limit = Math.max(1, Math.min(500, Number(count) || 50))

        let query, params
        if (platform === 'all') {
            // 联合查询所有平台
            if (runId) {
                query = `
                    SELECT * FROM (
                        SELECT *, 'twitter' as source FROM twitter_posts WHERE run_id = $1
                        UNION ALL
                        SELECT *, 'tiktok' as source FROM tiktok_posts WHERE run_id = $1
                        UNION ALL
                        SELECT *, 'youtube' as source FROM youtube_posts WHERE run_id = $1
                        UNION ALL
                        SELECT *, 'instagram' as source FROM instagram_posts WHERE run_id = $1
                    ) AS combined
                    ORDER BY fetched_at DESC NULLS LAST
                    LIMIT $2
                `
                params = [String(runId), limit]
            } else {
                query = `
                    SELECT * FROM (
                        SELECT *, 'twitter' as source FROM twitter_posts
                        UNION ALL
                        SELECT *, 'tiktok' as source FROM tiktok_posts
                        UNION ALL
                        SELECT *, 'youtube' as source FROM youtube_posts
                        UNION ALL
                        SELECT *, 'instagram' as source FROM instagram_posts
                    ) AS combined
                    ORDER BY fetched_at DESC NULLS LAST
                    LIMIT $1
                `
                params = [limit]
            }
        } else {
            // 单个平台查询
            const tableName = `${platform}_posts`
            if (runId) {
                query = `SELECT * FROM ${tableName} WHERE run_id = $1 ORDER BY fetched_at DESC NULLS LAST LIMIT $2`
                params = [String(runId), limit]
            } else {
                query = `SELECT * FROM ${tableName} ORDER BY fetched_at DESC NULLS LAST LIMIT $1`
                params = [limit]
            }
        }

        const result = await pgPool.query(query, params)
        return res.json({ items: result.rows || [], count: (result.rows || []).length })
    } catch (e) {
        console.error('[latest] 查询异常:', e)
        return res.status(500).json({ error: '查询失败', detail: String(e?.message || e) })
    }
})

// 获取选题发现运行历史
app.get('/api/sourcing/runs', async (req, res) => {
    try {
        const { limit = 50 } = req.query
        const result = await pgPool.query(
            'SELECT id, platforms, keywords, count, started_at FROM sourcing_runs ORDER BY started_at DESC LIMIT $1',
            [Math.max(1, Math.min(200, Number(limit) || 50))]
        )
        const items = (result.rows || []).map(r => ({
            id: r.id,
            platforms: r.platforms ? r.platforms.split(',').filter(Boolean) : [],
            keywords: r.keywords ? r.keywords.split(',').filter(Boolean) : [],
            count: r.count || 0,
            started_at: r.started_at
        }))
        return res.json({ items })
    } catch (e) {
        console.error('[runs] 查询异常:', e)
        return res.status(500).json({ error: '查询运行历史失败', detail: String(e?.message || e) })
    }
})

// 删除选题发现运行记录及相关数据
app.delete('/api/sourcing/runs/:runId', async (req, res) => {
    try {
        const { runId } = req.params
        if (!runId || typeof runId !== 'string') {
            return res.status(400).json({ error: 'runId 必填且必须是字符串' })
        }

        const client = await pgPool.connect()
        try {
            await client.query('BEGIN')

            // 统计即将删除的数据量
            const stats = await Promise.all([
                client.query('SELECT COUNT(*) as count FROM sourcing_runs WHERE id = $1', [runId]),
                client.query('SELECT COUNT(*) as count FROM tiktok_posts WHERE run_id = $1', [runId]),
                client.query('SELECT COUNT(*) as count FROM youtube_posts WHERE run_id = $1', [runId]),
                client.query('SELECT COUNT(*) as count FROM twitter_posts WHERE run_id = $1', [runId]),
                client.query('SELECT COUNT(*) as count FROM instagram_posts WHERE run_id = $1', [runId])
            ])

            const [runsCount, tiktokCount, youtubeCount, twitterCount, instagramCount] = stats.map(s =>
                parseInt(s.rows[0]?.count || '0')
            )

            if (runsCount === 0) {
                await client.query('ROLLBACK')
                return res.status(404).json({ error: '未找到指定的运行记录' })
            }

            // 删除各平台的帖子数据
            await Promise.all([
                client.query('DELETE FROM tiktok_posts WHERE run_id = $1', [runId]),
                client.query('DELETE FROM youtube_posts WHERE run_id = $1', [runId]),
                client.query('DELETE FROM twitter_posts WHERE run_id = $1', [runId]),
                client.query('DELETE FROM instagram_posts WHERE run_id = $1', [runId])
            ])

            // 删除运行记录
            await client.query('DELETE FROM sourcing_runs WHERE id = $1', [runId])

            await client.query('COMMIT')

            console.log(`[delete-run] 成功删除运行记录 ${runId} 及相关数据:`, {
                tiktok: tiktokCount,
                youtube: youtubeCount,
                twitter: twitterCount,
                instagram: instagramCount
            })

            return res.json({
                success: true,
                deleted: {
                    runs: runsCount,
                    tiktok: tiktokCount,
                    youtube: youtubeCount,
                    twitter: twitterCount,
                    instagram: instagramCount,
                    total: tiktokCount + youtubeCount + twitterCount + instagramCount
                }
            })
        } catch (e) {
            await client.query('ROLLBACK')
            throw e
        } finally {
            client.release()
        }
    } catch (e) {
        console.error('[delete-run] 删除失败:', e)
        return res.status(500).json({ error: '删除运行记录失败', detail: String(e?.message || e) })
    }
})

// 数据标准化函数
function normalizeTikTok(raw, keywords) {
    const normalized = []
    const seen = new Set()

    const normalizeToken = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
    const wanted = Array.isArray(keywords) ? keywords.map(normalizeToken).filter(Boolean) : []
    const wantedSet = new Set(wanted)

    for (const it of raw) {
        const discoveredKw = it.input || it.discovery_input?.search_keyword || it.search_keyword || it.keyword || ''

        // 更宽松的关键词匹配：支持 hashtag、searchHashtag、caption 文本模糊包含
        if (wanted.length > 0) {
            const candidateTokens = []
            if (discoveredKw) candidateTokens.push(discoveredKw)
            if (it.searchHashtag?.name) candidateTokens.push(it.searchHashtag.name)
            if (Array.isArray(it.hashtags)) {
                for (const h of it.hashtags) if (h && h.name) candidateTokens.push(h.name)
            }
            const textFields = [it.text, it.title, it.description, it.desc, it.caption]
            const textJoined = textFields.map(v => String(v || '')).join(' ').toLowerCase()

            let matched = false
            for (const token of candidateTokens) {
                if (wantedSet.has(normalizeToken(token))) { matched = true; break }
            }
            if (!matched) {
                for (const rawKw of keywords) {
                    if (rawKw && textJoined.includes(String(rawKw).toLowerCase())) { matched = true; break }
                }
            }
            if (!matched) continue
        }

        const platform = 'tiktok'
        const url = it.webVideoUrl || it.url || it.share_url || it.tiktokLink || ''

        // 修复时间戳转换问题：确保转换为 PostgreSQL 兼容的 ISO 格式
        let published_at = null
        const rawTime = it.createTime || it.createTimeISO || it.create_time || it.timestamp || it.published_at
        if (rawTime) {
            try {
                // 如果是Unix时间戳（数字或数字字符串），转换为毫秒并创建Date对象
                if (typeof rawTime === 'number' || (typeof rawTime === 'string' && /^\d+$/.test(rawTime))) {
                    const timestamp = Number(rawTime)
                    // Unix时间戳通常是10位（秒）或13位（毫秒）
                    const milliseconds = timestamp.toString().length === 10 ? timestamp * 1000 : timestamp
                    published_at = new Date(milliseconds).toISOString()
                } else {
                    // 如果已经是ISO格式或其他日期字符串，直接解析
                    published_at = new Date(rawTime).toISOString()
                }
            } catch (e) {
                console.warn('[normalizeTikTok] 时间戳转换失败:', rawTime, e?.message)
                published_at = null
            }
        }
        // 改进去重：优先使用 post id 或 URL + 时间；如果两者都不存在，允许通过，避免误伤
        const keyBase = (it.id || it.post_id || '') + '|' + (url || '') + '|' + (published_at || '')
        const h = hashOf(platform, keyBase, '')
        if (seen.has(h)) {
            continue
        }
        seen.add(h)

        normalized.push({
            postId: (it.id && `tiktok:${it.id}`) || (it.post_id && `tiktok:${it.post_id}`) || h,
            platform,
            keyword: discoveredKw,
            author: it.authorMeta?.uniqueId || it.authorMeta?.nickname || it.profile_username || it.author_name || it.username || it.author || it.account_id || '',
            url,
            title: (it.text || it.title || it.description || it.desc || '').slice(0, 80),
            desc: it.text || it.description || it.desc || it.caption || '',
            published_at,
            likes: it.diggCount || it.digg_count || it.like_count || it.likes || 0,
            comments: it.commentCount || it.comment_count || it.comments || 0,
            shares: it.shareCount || it.share_count || it.shares || 0,
            views: it.playCount || it.play_count || it.views || 0,
            followers: it.authorMeta?.followerCount || it.profile_followers || it.author_followers || it.followers || 0,
            fetched_at: new Date().toISOString(),
            raw_data: it
        })
    }
    return normalized
}

// 将 YouTube 原始数据标准化为统一结构
function normalizeYouTube(raw, keywords) {
    const normalized = []
    const seen = new Set()
    for (const it of raw) {
        // 关键词来源：Bright Data 的 discover 输入或字段 keyword
        const discoveredKw = it.input?.discovery_input?.keyword || it.discovery_input?.keyword || it.keyword || ''
        if (Array.isArray(keywords) && keywords.length > 0 && discoveredKw && !keywords.includes(discoveredKw)) continue

        const platform = 'youtube'
        const url = it.url || it.video_url || ''
        const published_at = it.timestamp || it.date_posted || it.published_at || null
        const h = hashOf(platform, url, published_at)
        if (seen.has(h)) continue
        seen.add(h)

        normalized.push({
            postId: (it.id && `youtube:${it.id}`) || (it.video_id && `youtube:${it.video_id}`) || h,
            platform,
            keyword: discoveredKw,
            author: it.channel?.channel_name || it.youtuber || it.handle_name || '',
            url: it.url || '',
            title: (it.title || '').slice(0, 120),
            desc: it.description || '',
            published_at,
            likes: it.likes || 0,
            comments: it.comments || it.num_comments || 0,
            shares: 0,
            views: it.views || 0,
            followers: it.channel?.subscriber_count || it.subscribers || 0,
            fetched_at: new Date().toISOString(),
            raw_data: it
        })
    }
    return normalized
}

// 将 Instagram 原始数据标准化为统一结构
function normalizeInstagram(raw, keywords) {
    const normalized = []
    const seen = new Set()
    for (const it of raw) {
        const platform = 'instagram'
        const url = it.url || it.displayUrl || it.shortcode ? `https://www.instagram.com/p/${it.shortcode}/` : ''
        const published_at = it.timestamp || it.taken_at_timestamp ? new Date(it.taken_at_timestamp * 1000).toISOString() : null
        const h = hashOf(platform, url, published_at)
        if (seen.has(h)) continue
        seen.add(h)

        // 尝试从多个字段提取标题和描述
        const caption = it.caption || it.edge_media_to_caption?.edges?.[0]?.node?.text || ''
        const title = caption.slice(0, 80) || '无标题'

        normalized.push({
            postId: (it.id && `instagram:${it.id}`) || (it.shortcode && `instagram:${it.shortcode}`) || h,
            platform,
            keyword: '', // Instagram 通常通过 hashtag 或 profile 搜索，不直接关联单个关键词
            author: it.owner?.username || it.username || it.user?.username || '',
            url,
            title,
            desc: caption,
            published_at,
            likes: it.edge_media_preview_like?.count || it.like_count || 0,
            comments: it.edge_media_to_comment?.count || it.comment_count || 0,
            shares: 0, // Instagram API 不提供分享数
            views: it.video_view_count || it.view_count || 0,
            followers: it.owner?.edge_followed_by?.count || 0,
            fetched_at: new Date().toISOString(),
            raw_data: it
        })
    }
    return normalized
}

// 分页获取帖子数据（兼容前端调用）
app.get('/api/sourcing/posts', async (req, res) => {
    try {
        const { platform = 'all', page = 1, pageSize = 20, runId = '' } = req.query
        const limit = Math.max(1, Math.min(100, Number(pageSize) || 20))
        const offset = Math.max(0, (Number(page) - 1) * limit)

        let query, params
        let countQuery, countParams
        if (platform === 'all') {
            if (runId) {
                query = `
                    SELECT * FROM (
                        SELECT *, 'twitter' as source FROM twitter_posts WHERE run_id = $1
                        UNION ALL
                        SELECT *, 'tiktok' as source FROM tiktok_posts WHERE run_id = $1
                        UNION ALL
                        SELECT *, 'youtube' as source FROM youtube_posts WHERE run_id = $1
                        UNION ALL
                        SELECT *, 'instagram' as source FROM instagram_posts WHERE run_id = $1
                    ) AS combined
                    ORDER BY fetched_at DESC NULLS LAST
                    LIMIT $2 OFFSET $3
                `
                params = [String(runId), limit, offset]

                // 统计总数（不受分页影响）
                countQuery = `
                    SELECT (
                        (SELECT COUNT(*) FROM twitter_posts WHERE run_id = $1) +
                        (SELECT COUNT(*) FROM tiktok_posts WHERE run_id = $1) +
                        (SELECT COUNT(*) FROM youtube_posts WHERE run_id = $1) +
                        (SELECT COUNT(*) FROM instagram_posts WHERE run_id = $1)
                    ) AS total
                `
                countParams = [String(runId)]
            } else {
                query = `
                    SELECT * FROM (
                        SELECT *, 'twitter' as source FROM twitter_posts
                        UNION ALL
                        SELECT *, 'tiktok' as source FROM tiktok_posts
                        UNION ALL
                        SELECT *, 'youtube' as source FROM youtube_posts
                        UNION ALL
                        SELECT *, 'instagram' as source FROM instagram_posts
                    ) AS combined
                    ORDER BY fetched_at DESC NULLS LAST
                    LIMIT $1 OFFSET $2
                `
                params = [limit, offset]

                // 统计总数（不受分页影响）
                countQuery = `
                    SELECT (
                        (SELECT COUNT(*) FROM twitter_posts) +
                        (SELECT COUNT(*) FROM tiktok_posts) +
                        (SELECT COUNT(*) FROM youtube_posts) +
                        (SELECT COUNT(*) FROM instagram_posts)
                    ) AS total
                `
                countParams = []
            }
        } else {
            const tableName = `${platform}_posts`
            if (runId) {
                query = `SELECT * FROM ${tableName} WHERE run_id = $1 ORDER BY fetched_at DESC NULLS LAST LIMIT $2 OFFSET $3`
                params = [String(runId), limit, offset]

                countQuery = `SELECT COUNT(*) AS total FROM ${tableName} WHERE run_id = $1`
                countParams = [String(runId)]
            } else {
                query = `SELECT * FROM ${tableName} ORDER BY fetched_at DESC NULLS LAST LIMIT $1 OFFSET $2`
                params = [limit, offset]

                countQuery = `SELECT COUNT(*) AS total FROM ${tableName}`
                countParams = []
            }
        }

        const [result, countResult] = await Promise.all([
            pgPool.query(query, params),
            pgPool.query(countQuery, countParams)
        ])
        const totalCount = parseInt(countResult?.rows?.[0]?.total || '0')
        return res.json({
            items: result.rows || [],
            total: totalCount,
            page: Number(page),
            pageSize: limit
        })
    } catch (e) {
        console.error('[posts] 查询异常:', e)
        return res.status(500).json({ error: '查询失败', detail: String(e?.message || e) })
    }
})

// 健康检查端点（用于免费云平台的健康监测）
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    })
})

// 根路径路由：提供 API 信息
app.get('/', (req, res) => {
    res.json({
        name: '批量处理服务 API',
        version: '1.0.0',
        status: 'running',
        description: '支持小红书 MCP 爬虫的批量处理后端服务',
        endpoints: {
            health: '/health',
            api_health: '/api/health',
            metrics: '/api/metrics',
            xiaohongshu_search: '/api/sourcing/xiaohongshu/search'
        },
        timestamp: new Date().toISOString()
    })
})

// 健康检查路由（简化版）
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    })
})

// 兼容健康检查：增加 /api/health 路由，保持与前端代理与Docker健康检查一致
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    })
})

// 基础指标端点：仅返回轻量运行指标（不含敏感信息）
app.get('/api/metrics', async (req, res) => {
    try {
        const mem = process.memoryUsage()
        const rssMb = Math.round((mem.rss || 0) / 1024 / 1024)
        const heapUsedMb = Math.round((mem.heapUsed || 0) / 1024 / 1024)
        const activeJobs = jobs.size
        res.json({
            uptime: process.uptime(),
            rss_mb: rssMb,
            heap_used_mb: heapUsedMb,
            active_jobs: activeJobs,
            timestamp: new Date().toISOString()
        })
    } catch (e) {
        res.status(500).json({ error: 'metrics failed' })
    }
})

// 启动服务器 + 优雅停机
const server = app.listen(PORT, () => {
    console.log(`✅ 批量处理服务已启动: http://localhost:${PORT}`)
    console.log(`📊 健康检查: http://localhost:${PORT}/health`)
})

async function shutdown() {
    console.log('🛑 接收到退出信号，开始优雅停机...')
    try {
        await new Promise((resolve) => server.close(() => resolve()))
        await pgPool.end().catch(() => { })
        console.log('✅ 资源释放完成，进程退出')
        process.exit(0)
    } catch (e) {
        console.error('❌ 停机失败，强制退出:', e)
        process.exit(1)
    }
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

