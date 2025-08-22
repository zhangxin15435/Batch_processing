// 选题发现服务：前端仅调用本地后端接口，避免泄露 Bright Data 密钥

const BASE = ''

// TikTok：直接同步运行并返回结果
export async function runTikTokInstant(payload: { keywords: string[]; count: number; runId?: string }): Promise<{ items: any[]; rawCount?: number }> {
    const res = await fetch(`${BASE}/api/sourcing/tiktok/instant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error(`TikTok 同步抓取失败: ${res.status}`)
    return res.json()
}

export async function fetchLatestTikTokData(count: number = 20): Promise<{ items: any[]; snapshots?: any[]; totalAvailable?: number }> {
    const url = new URL(`${BASE}/api/sourcing/tiktok/latest`, window.location.origin)
    url.searchParams.set('count', String(count))
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`获取最新数据失败: ${res.status}`)
    return res.json()
}



// YouTube 相关接口
export async function triggerYouTubeJob(payload: { keywords: string[]; count: number; runId?: string; start_date?: string; end_date?: string; country?: string }): Promise<{ jobId?: string; snapshotId?: string; mode?: string; runId?: string }> {
    const res = await fetch(`${BASE}/api/sourcing/youtube/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error(`YouTube 触发失败: ${res.status}`)
    return res.json()
}

export async function fetchYouTubeResults(params: { jobId: string; count: number; runId?: string }): Promise<{ items: any[]; runId?: string }> {
    const url = new URL(`${BASE}/api/sourcing/youtube/results`, window.location.origin)
    url.searchParams.set('jobId', params.jobId)
    url.searchParams.set('count', String(params.count))
    if (params.runId) url.searchParams.set('runId', String(params.runId))
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`YouTube 拉取失败: ${res.status}`)
    return res.json()
}

export async function fetchLatestYouTubeData(count: number = 20): Promise<{ items: any[]; snapshots?: any[]; totalAvailable?: number }> {
    const url = new URL(`${BASE}/api/sourcing/youtube/latest`, window.location.origin)
    url.searchParams.set('count', String(count))
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`YouTube 获取最新数据失败: ${res.status}`)
    return res.json()
}

// —— 新增：YouTube 快照相关接口 ——
// 列出 Bright Data 上该 YouTube 数据集的全部快照
export async function listYouTubeSnapshots(): Promise<{ items: Array<{ id: string; created: string; status: string; size?: number }> }> {
    const res = await fetch(`${BASE}/api/sourcing/youtube/snapshots`)
    if (!res.ok) throw new Error(`快照列表获取失败: ${res.status}`)
    return res.json()
}

// 读取某个快照的条目（默认不入库，除非 save=true）
export async function fetchYouTubeSnapshotItems(params: { snapshotId: string; count?: number; save?: boolean; runId?: string }): Promise<{ items: any[]; rawCount?: number; runId?: string }> {
    const url = new URL(`${BASE}/api/sourcing/youtube/snapshots/${encodeURIComponent(params.snapshotId)}/items`, window.location.origin)
    if (params.count != null) url.searchParams.set('count', String(params.count))
    if (params.runId) url.searchParams.set('runId', String(params.runId))
    if (params.save) url.searchParams.set('save', 'true')
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`读取快照数据失败: ${res.status}`)
    return res.json()
}

// 将用户勾选的条目批量入库（前端选择后再保存，避免一次全量入库）
export async function saveYouTubeItems(items: any[], runId?: string): Promise<{ ok: boolean; saved: number }> {
    const res = await fetch(`${BASE}/api/sourcing/youtube/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, runId })
    })
    if (!res.ok) throw new Error(`入库失败: ${res.status}`)
    return res.json()
}

// Instagram：关键词搜索并实时入库
export async function triggerInstagramSearch(payload: { keywords: string[]; type?: 'hashtag' | 'profile'; limit?: number; runId?: string }): Promise<{ items: any[]; saved?: number; runId?: string }> {
    const res = await fetch(`${BASE}/api/sourcing/instagram/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error(`Instagram 抓取失败: ${res.status}`)
    return res.json()
}

// Twitter：调用后端触发端点，返回标准化数据
export async function triggerTwitterCrawler(payload: { keywords: string[]; count: number; mode?: 'latest' | 'top'; runId?: string }): Promise<{ items: any[]; saved?: number; runId?: string }> {
    const res = await fetch(`/api/sourcing/twitter/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error(`Twitter 抓取失败: ${res.status}`)
    return res.json()
}

// 读取本地数据库中已入库的最新帖子（任意平台）
export async function fetchLatestPosts(params: {
    platform?: 'all' | 'tiktok' | 'youtube' | 'twitter' | 'instagram'
    limit?: number
    keyword?: string
    start?: string
    end?: string
    page?: number
    pageSize?: number
    runId?: string
}): Promise<{ items: any[]; total: number }> {
    const url = new URL(`${BASE}/api/sourcing/posts`, window.location.origin)
    if (params.platform) url.searchParams.set('platform', String(params.platform))
    if (params.limit != null) url.searchParams.set('limit', String(params.limit))
    if (params.keyword) url.searchParams.set('keyword', params.keyword)
    if (params.start) url.searchParams.set('start', params.start)
    if (params.end) url.searchParams.set('end', params.end)
    if (params.page != null) url.searchParams.set('page', String(params.page))
    if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
    if (params.runId) url.searchParams.set('runId', String(params.runId))
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`读取数据库最新数据失败: ${res.status}`)
    return res.json()
}

// 创建/记录一次选题发现
export async function createSourcingRun(payload: { id?: string; platforms: string[]; keywords: string[]; count?: number }): Promise<{ ok: boolean; id: string }> {
    const res = await fetch(`${BASE}/api/sourcing/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error(`创建选题记录失败: ${res.status}`)
    return res.json()
}

// 列出最近的选题发现记录
export async function listSourcingRuns(limit = 100): Promise<{ items: Array<{ id: string; platforms: string[]; keywords: string[]; count: number; started_at: string }> }> {
    const url = new URL(`${BASE}/api/sourcing/runs`, window.location.origin)
    url.searchParams.set('limit', String(limit))
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`读取选题记录失败: ${res.status}`)
    return res.json()
}


// 删除选题发现运行记录及相关数据
export async function deleteSourcingRun(runId: string): Promise<{ success: boolean; deleted: any }> {
    const res = await fetch(`${BASE}/api/sourcing/runs/${encodeURIComponent(runId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
    })
    if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || `删除运行记录失败: ${res.status}`)
    }
    return res.json()
}


