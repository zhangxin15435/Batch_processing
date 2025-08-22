import React, { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/appStore'
import { runTikTokInstant, triggerYouTubeJob, fetchYouTubeResults, triggerTwitterCrawler, triggerInstagramSearch, listSourcingRuns, createSourcingRun, listYouTubeSnapshots, fetchYouTubeSnapshotItems, saveYouTubeItems } from '@/services/sourcingService'
import { Loader2, PlayCircle, Link as LinkIcon, PlusCircle, RefreshCw } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const SourcingPanel: React.FC = () => {
    const { addTextItem, setCurrentView } = useAppStore()
    const [keywordsInput, setKeywordsInput] = useState('prompt')
    const [count, setCount] = useState(20)
    const [loading, setLoading] = useState(false)
    const [twitterMode, setTwitterMode] = useState<'latest' | 'top'>('top')
    const [platforms, setPlatforms] = useState<{ tiktok: boolean; youtube: boolean; twitter: boolean; instagram: boolean }>({ tiktok: true, youtube: true, twitter: false, instagram: false })
    const [items, setItems] = useState<any[]>([])
    const [runs, setRuns] = useState<Array<{ id: string; platforms: string[]; keywords: string[]; count: number; started_at: string }>>([])

    const [latestPlatform, setLatestPlatform] = useState<'all' | 'tiktok' | 'youtube' | 'twitter' | 'instagram'>('all')
    const [startTime, setStartTime] = useState<string>('')
    const [endTime, setEndTime] = useState<string>('')
    // YouTube 快照拉取：允许输入 jobId 或使用 latest 快照
    const [ytJobId, setYtJobId] = useState<string>('')
    const [ytSnapshots, setYtSnapshots] = useState<Array<{ id: string; created: string; status: string; size?: number }>>([])
    const [ytSnapshotItems, setYtSnapshotItems] = useState<any[]>([])
    const [ytSelectedIds, setYtSelectedIds] = useState<Record<string, boolean>>({})

    // —— 概览与运行状态 ——
    const [overview, setOverview] = useState<{ total: number; platforms: Record<'tiktok' | 'youtube' | 'twitter' | 'instagram', { total: number; latestTime?: string }> }>({
        total: 0,
        platforms: { tiktok: { total: 0 }, youtube: { total: 0 }, twitter: { total: 0 }, instagram: { total: 0 } }
    })
    const [isRunning, setIsRunning] = useState(false)
    const [jobStages, setJobStages] = useState<Record<'tiktok' | 'youtube' | 'twitter' | 'instagram', { status: 'idle' | 'running' | 'done' | 'error'; items: number }>>({
        tiktok: { status: 'idle', items: 0 },
        youtube: { status: 'idle', items: 0 },
        twitter: { status: 'idle', items: 0 },
        instagram: { status: 'idle', items: 0 }
    })
    const [activeRunId, setActiveRunId] = useState<string>('')

    // 简化的日志函数，用于调试输出
    const pushLog = (text: string, level: 'info' | 'warn' | 'error' = 'info') => {
        console.log(`[${level.toUpperCase()}] ${text}`)
    }

    const resetStages = () => setJobStages({
        tiktok: { status: 'idle', items: 0 },
        youtube: { status: 'idle', items: 0 },
        twitter: { status: 'idle', items: 0 },
        instagram: { status: 'idle', items: 0 }
    })

    const parseKeywords = (): string[] => {
        return keywordsInput
            .split(/[\n,，]/)
            .map(k => k.trim())
            .filter(Boolean)
    }

    const handleTrigger = async () => {
        try {
            setLoading(true)
            setIsRunning(true)
            // 重置时清空相关状态
            resetStages()
            const runId = `${Date.now()}-run`
            const keywords = parseKeywords()
            const aggregated: any[] = []
            // 记录批次
            try {
                const platformsChosen = [
                    platforms.tiktok ? 'tiktok' : null,
                    platforms.youtube ? 'youtube' : null,
                    platforms.twitter ? 'twitter' : null,
                    platforms.instagram ? 'instagram' : null
                ].filter(Boolean) as string[]
                await createSourcingRun({ id: runId, platforms: platformsChosen, keywords, count })
            } catch { }

            if (platforms.tiktok) {
                // TikTok 同步抓取
                setJobStages(prev => ({ ...prev, tiktok: { ...prev.tiktok, status: 'running' } }))
                const resp = await runTikTokInstant({ keywords, count, runId })
                aggregated.push(...(resp.items || []))
                setJobStages(prev => ({ ...prev, tiktok: { status: 'done', items: prev.tiktok.items + (resp.items || []).length } }))
            }

            if (platforms.youtube) {
                setJobStages(prev => ({ ...prev, youtube: { ...prev.youtube, status: 'running' } }))
                const respY = await triggerYouTubeJob({ keywords, count, runId })
                if ((respY as any).items && (respY as any).items.length > 0) {
                    aggregated.push(...(respY as any).items)
                    setJobStages(prev => ({ ...prev, youtube: { status: 'done', items: prev.youtube.items + (respY as any).items.length } }))
                } else if (respY.jobId) {
                    // 添加等待和重试逻辑
                    console.log('YouTube任务已触发，等待数据准备...', respY.jobId)
                    let retries = 0
                    const maxRetries = 6 // 最多重试6次
                    const retryDelay = 10000 // 每次等待10秒

                    while (retries < maxRetries) {
                        if (retries > 0) {
                            console.log(`YouTube数据获取重试 ${retries}/${maxRetries}，等待${retryDelay / 1000}秒...`)
                            await new Promise(resolve => setTimeout(resolve, retryDelay))
                        }

                        try {
                            const listY = await fetchYouTubeResults({ jobId: respY.jobId, count, runId })
                            if (listY.items && listY.items.length > 0) {
                                console.log(`YouTube数据获取成功：${listY.items.length}条记录`)
                                aggregated.push(...listY.items)
                                setJobStages(prev => ({ ...prev, youtube: { status: 'done', items: prev.youtube.items + listY.items.length } }))
                                break
                            } else {
                                console.log('YouTube数据尚未准备就绪，继续等待...')
                                retries++
                            }
                        } catch (error) {
                            console.error('YouTube数据获取错误:', error)
                            retries++
                        }
                    }

                    if (retries >= maxRetries) {
                        console.warn('YouTube数据获取超时，请稍后在历史记录中查看')
                        setJobStages(prev => ({ ...prev, youtube: { status: 'done', items: prev.youtube.items } }))
                    }
                }
            }

            if (platforms.twitter) {
                // 触发后端脚本并拿到结果，合并到列表
                try {
                    // 传递用户选择的模式（Top/Latest）
                    setJobStages(prev => ({ ...prev, twitter: { ...prev.twitter, status: 'running' } }))
                    const tw = await triggerTwitterCrawler({ keywords, count, mode: twitterMode, runId })
                    aggregated.push(...(tw.items || []))
                    setJobStages(prev => ({ ...prev, twitter: { status: 'done', items: prev.twitter.items + (tw.items || []).length } }))
                } catch (e) {
                    console.error(e)
                    pushLog('Twitter：抓取失败', 'error')
                    setJobStages(prev => ({ ...prev, twitter: { ...prev.twitter, status: 'error' } }))
                }
            }

            if (platforms.instagram) {
                // 默认按 hashtag 模式抓取；仅当明确使用 '@账号' 或完整 URL 时才切换为 profile 模式
                const cleaned = keywords.map(k => k.trim()).filter(Boolean)
                const explicitlyProfile = cleaned.some(k => k.startsWith('@') || k.startsWith('http'))
                const type: 'hashtag' | 'profile' = explicitlyProfile ? 'profile' : 'hashtag'
                const normalized = cleaned.map(k => {
                    if (type === 'profile') return k
                    return k.startsWith('#') ? k : `#${k}`
                })
                try {
                    setJobStages(prev => ({ ...prev, instagram: { ...prev.instagram, status: 'running' } }))
                    const ig = await triggerInstagramSearch({ keywords: normalized, type, limit: count, runId })
                    aggregated.push(...(ig.items || []))
                    setJobStages(prev => ({ ...prev, instagram: { status: 'done', items: prev.instagram.items + (ig.items || []).length } }))
                } catch (e) {
                    console.error(e)
                    pushLog('Instagram：抓取失败', 'error')
                    setJobStages(prev => ({ ...prev, instagram: { ...prev.instagram, status: 'error' } }))
                }
            }

            setItems(aggregated)
            // 刷新“选题发现记录”
            try {
                const r = await listSourcingRuns(50)
                setRuns(r.items || [])
            } catch { }
        } catch (e) {
            alert('触发或拉取失败，请稍后重试')
            console.error(e)
        } finally {
            setLoading(false)
            setIsRunning(false)
        }
    }

    // 删除“刷新结果”按钮逻辑

    const handleGetLatest = async () => {
        try {
            setLoading(true)
            // 从数据库读取“全部数据”，并按选择的平台过滤（不传 limit 即返回全部）
            const { fetchLatestPosts } = await import('@/services/sourcingService')
            const startIso = startTime ? new Date(startTime).toISOString() : ''
            const endIso = endTime ? new Date(endTime).toISOString() : ''
            const { items } = await fetchLatestPosts({ platform: latestPlatform, start: startIso, end: endIso })
            setItems(items || [])
        } catch (e) {
            alert('获取最新数据失败，请稍后重试')
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    const handleGetLastRunOnly = async () => {
        try {
            setLoading(true)
            const { fetchLatestPosts } = await import('@/services/sourcingService')
            // 读取全部，然后只保留 fetched_at 最大的一次抓取的记录
            const { items } = await fetchLatestPosts({ platform: latestPlatform })
            if (!items || items.length === 0) {
                setItems([])
                return
            }
            // 找到最新的 fetched_at 时间点
            let latestTs = 0
            for (const it of items) {
                const ts = new Date(it.fetched_at || it.published_at || 0).getTime()
                if (Number.isFinite(ts) && ts > latestTs) latestTs = ts
            }
            // 允许 2 分钟窗口（同一轮抓取的多条记录）
            const windowMs = 2 * 60 * 1000
            const filtered = items.filter(it => {
                const ts = new Date(it.fetched_at || it.published_at || 0).getTime()
                return Number.isFinite(ts) && latestTs - ts <= windowMs
            })
            setItems(filtered)
        } catch (e) {
            alert('获取最近一次数据失败，请稍后重试')
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    // 刷新概览：读取各个平台总数与最新时间
    const refreshOverview = async () => {
        try {
            const { fetchLatestPosts } = await import('@/services/sourcingService')
            const platforms: Array<'tiktok' | 'youtube' | 'twitter' | 'instagram'> = ['tiktok', 'youtube', 'twitter', 'instagram']
            const results = await Promise.all(platforms.map(async p => {
                const r = await fetchLatestPosts({ platform: p, page: 1 as any, pageSize: 1 as any })
                const latestTime = r.items && r.items[0] ? String(r.items[0].fetched_at || r.items[0].published_at || '') : ''
                return { p, total: Number(r.total || 0), latestTime }
            }))
            const next: typeof overview = {
                total: results.reduce((s, it) => s + it.total, 0),
                platforms: { tiktok: { total: 0 }, youtube: { total: 0 }, twitter: { total: 0 }, instagram: { total: 0 } }
            }
            for (const it of results) {
                ; (next.platforms as any)[it.p] = { total: it.total, latestTime: it.latestTime }
            }
            setOverview(next)
        } catch { }
    }

    useEffect(() => { refreshOverview() }, [])

    const importToWorkflow = (item: any) => {
        // 将该条目的摘要整理为文本，添加为文本条目，用户可直接在现有工作流中处理
        const summary = `平台: ${item.platform}\n关键词: ${item.keyword}\n标题: ${item.title || ''}\n作者: ${item.author || ''}\n链接: ${item.url}\n发布时间: ${item.published_at || ''}\n指标: ❤ ${item.likes}  💬 ${item.comments}  🔁 ${item.shares}  👀 ${item.views}\n\n描述:\n${item.desc || ''}`
        addTextItem(summary)
        setCurrentView('workflow')
    }

    return (
        <div className="space-y-6">
            <Card className="card-hover">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">🧭 选题发现（TikTok 优先，手动触发）</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* 概览 */}
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <div className="p-3 border rounded-md">
                            <div className="text-xs text-muted-foreground mb-1">总条数</div>
                            <div className="text-2xl font-semibold">{overview.total}</div>
                        </div>
                        {(['tiktok', 'youtube', 'twitter', 'instagram'] as const).map(p => (
                            <div key={p} className="p-3 border rounded-md">
                                <div className="text-xs text-muted-foreground mb-1">{p.toUpperCase()}</div>
                                <div className="text-lg font-semibold">{overview.platforms[p].total}</div>
                                {overview.platforms[p].latestTime && (
                                    <div className="text-[11px] text-muted-foreground mt-1 break-all">最新: {String(overview.platforms[p].latestTime)}</div>
                                )}
                                <div className="mt-2">
                                    <Button size="sm" variant="secondary" disabled={loading} onClick={async () => {
                                        try {
                                            const { fetchLatestPosts } = await import('@/services/sourcingService')
                                            const { items: rows } = await fetchLatestPosts({ platform: p, page: 1, pageSize: 2000 })
                                            if (!rows || rows.length === 0) { alert(`${p.toUpperCase()} 暂无可导出的数据`); return }
                                            const header = ['platform', 'keyword', 'author', 'url', 'title', 'desc', 'published_at', 'fetched_at', 'likes', 'comments', 'shares', 'views', 'followers']
                                            const esc = (s: any) => `"${String(s ?? '').replace(/\"/g, '""')}"`
                                            const csv = [header.join(',')].concat(
                                                rows.map((x: any) => [x.platform, x.keyword, x.author, x.url, x.title, x.desc, String(x.published_at || ''), String(x.fetched_at || ''), Number(x.likes || 0), Number(x.comments || 0), Number(x.shares || 0), Number(x.views || 0), Number(x.followers || 0)].map(esc).join(','))
                                            ).join('\n')
                                            const csvWithBom = '\ufeff' + csv
                                            const blob = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' })
                                            const url = URL.createObjectURL(blob)
                                            const a = document.createElement('a')
                                            a.href = url
                                            a.download = `latest_${p}.csv`
                                            a.click()
                                            URL.revokeObjectURL(url)
                                        } catch { alert('导出失败，请稍后再试') }
                                    }}>导出{p.toUpperCase()}</Button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-sm font-medium">关键词（换行或逗号分隔）</label>
                            <Input
                                value={keywordsInput}
                                onChange={(e) => setKeywordsInput(e.target.value)}
                                placeholder="例如：prompt, ai tools"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">抓取/显示条数</label>
                            <Input
                                type="number"
                                min={1}
                                max={100}
                                value={count}
                                onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                            />
                        </div>
                        <div className="space-y-2 md:col-span-3">
                            <label className="text-sm font-medium">平台</label>
                            <div className="flex items-center gap-4 text-sm">
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={platforms.tiktok} onChange={e => setPlatforms(p => ({ ...p, tiktok: e.target.checked }))} /> TikTok
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={platforms.youtube} onChange={e => setPlatforms(p => ({ ...p, youtube: e.target.checked }))} /> YouTube
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={platforms.twitter} onChange={e => setPlatforms(p => ({ ...p, twitter: e.target.checked }))} /> Twitter
                                    {platforms.twitter && (
                                        <div className="inline-flex items-center gap-2 ml-2 text-xs">
                                            <button
                                                type="button"
                                                className={`px-2 py-1 rounded border ${twitterMode === 'top' ? 'bg-blue-600 text-white' : 'bg-transparent'}`}
                                                onClick={() => setTwitterMode('top')}
                                            >Top</button>
                                            <button
                                                type="button"
                                                className={`px-2 py-1 rounded border ${twitterMode === 'latest' ? 'bg-blue-600 text-white' : 'bg-transparent'}`}
                                                onClick={() => setTwitterMode('latest')}
                                            >Latest</button>
                                        </div>
                                    )}
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={platforms.instagram} onChange={e => setPlatforms(p => ({ ...p, instagram: e.target.checked }))} /> Instagram
                                </label>
                                <Button size="sm" variant="ghost" onClick={() => setPlatforms({ tiktok: true, youtube: true, twitter: true, instagram: true })}>全选</Button>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <Button onClick={handleTrigger} disabled={loading || isRunning} title={isRunning ? '抓取进行中，请稍候...' : undefined}>
                            {(loading || isRunning) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
                            {(loading || isRunning) ? '进行中...' : '手动触发抓取'}
                        </Button>
                        <div className="flex items-center gap-2">
                            <Select value={latestPlatform} onValueChange={(v) => setLatestPlatform(v as any)}>
                                <SelectTrigger className="w-40">
                                    <SelectValue placeholder="选择平台" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">全部平台</SelectItem>
                                    <SelectItem value="tiktok">TikTok</SelectItem>
                                    <SelectItem value="youtube">YouTube</SelectItem>
                                    <SelectItem value="twitter">Twitter</SelectItem>
                                    <SelectItem value="instagram">Instagram</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="flex items-center gap-2">
                                <div className="flex flex-col">
                                    <label className="text-xs text-muted-foreground">开始</label>
                                    <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-48" />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-xs text-muted-foreground">结束</label>
                                    <Input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-48" />
                                </div>
                            </div>
                            <Button variant="secondary" onClick={handleGetLatest} disabled={loading || isRunning}>
                                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                获取数据库全部
                            </Button>
                            <Button variant="outline" onClick={handleGetLastRunOnly} disabled={loading || isRunning}>
                                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                只看最近一次
                            </Button>
                        </div>
                        {/* YouTube 快照拉取（按 jobId 或 latest） */}
                        <div className="flex items-center gap-2">
                            <div className="flex flex-col">
                                <label className="text-xs text-muted-foreground">YouTube 快照 jobId</label>
                                <Input
                                    placeholder="输入 jobId，留空使用 latest"
                                    value={ytJobId}
                                    onChange={(e) => setYtJobId(e.target.value)}
                                    className="w-64"
                                />
                            </div>
                            <Button
                                variant="secondary"
                                disabled={loading || isRunning}
                                onClick={async () => {
                                    try {
                                        setLoading(true)
                                        const resp = await fetchYouTubeResults({ jobId: ytJobId.trim() || 'latest', count })
                                        setItems(resp.items || [])
                                        setJobStages(prev => ({ ...prev, youtube: { status: 'done', items: (resp.items || []).length } }))
                                    } catch (e) {
                                        alert('按 jobId 拉取失败，请稍后重试')
                                    } finally {
                                        setLoading(false)
                                    }
                                }}
                            >按 jobId 拉取</Button>
                            <Button
                                variant="outline"
                                disabled={loading || isRunning}
                                onClick={async () => {
                                    try {
                                        setLoading(true)
                                        const resp = await fetchYouTubeResults({ jobId: 'latest', count })
                                        setItems(resp.items || [])
                                        setJobStages(prev => ({ ...prev, youtube: { status: 'done', items: (resp.items || []).length } }))
                                    } catch (e) {
                                        alert('拉取 latest 快照失败，请稍后重试')
                                    } finally {
                                        setLoading(false)
                                    }
                                }}
                            >拉取 latest</Button>
                            <Button
                                variant="secondary"
                                disabled={loading || isRunning}
                                onClick={async () => {
                                    try {
                                        setLoading(true)
                                        const r = await listYouTubeSnapshots()
                                        setYtSnapshots(r.items || [])
                                    } catch (e) {
                                        alert('快照列表拉取失败')
                                    } finally {
                                        setLoading(false)
                                    }
                                }}
                            >列出全部快照</Button>
                        </div>
                        {/* 及列出全部快照 */}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>爬取进度与候选内容</CardTitle>
                </CardHeader>
                <CardContent>
                    {/* 快照列表与预览/选择入库 */}
                    {ytSnapshots.length > 0 && (
                        <div className="mb-4 border rounded">
                            <div className="p-2 text-sm font-medium bg-gray-50">YouTube 快照（点击“预览”查看并勾选入库）</div>
                            <div className="max-h-64 overflow-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="text-left p-2">ID</th>
                                            <th className="text-left p-2">创建时间</th>
                                            <th className="text-left p-2">状态</th>
                                            <th className="text-left p-2">大小</th>
                                            <th className="text-left p-2">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ytSnapshots.map(s => (
                                            <tr key={s.id} className="border-t">
                                                <td className="p-2 break-all">{s.id}</td>
                                                <td className="p-2 break-all">{s.created}</td>
                                                <td className="p-2 break-all">{s.status}</td>
                                                <td className="p-2">{s.size ?? '-'}</td>
                                                <td className="p-2">
                                                    <Button size="sm" variant="outline" disabled={loading} onClick={async () => {
                                                        try {
                                                            setLoading(true)
                                                            const r = await fetchYouTubeSnapshotItems({ snapshotId: s.id, count: 200 })
                                                            setYtSnapshotItems(r.items || [])
                                                            setYtSelectedIds({})
                                                        } catch { alert('预览失败') }
                                                        finally { setLoading(false) }
                                                    }}>预览</Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* 快照预览区：支持勾选入库 */}
                    {ytSnapshotItems.length > 0 && (
                        <div className="mb-4 border rounded">
                            <div className="p-2 flex items-center justify-between bg-gray-50">
                                <div className="text-sm font-medium">快照预览（最多显示 200 条，可勾选后入库）</div>
                                <div className="flex items-center gap-2">
                                    <Button size="sm" variant="outline" onClick={() => {
                                        const next: Record<string, boolean> = {}
                                        for (const it of ytSnapshotItems) {
                                            const k = it.postId || it.id || it.url || Math.random().toString(36).slice(2)
                                            next[k] = true
                                        }
                                        setYtSelectedIds(next)
                                    }}>全选</Button>
                                    <Button size="sm" variant="outline" onClick={() => setYtSelectedIds({})}>清空</Button>
                                    <Button size="sm" onClick={async () => {
                                        try {
                                            const selected = ytSnapshotItems.filter(it => ytSelectedIds[it.postId || it.id || it.url])
                                            if (selected.length === 0) { alert('请先勾选要入库的条目'); return }
                                            const { ok } = await saveYouTubeItems(selected)
                                            if (ok) alert('入库完成')
                                        } catch { alert('入库失败') }
                                    }}>勾选入库</Button>
                                </div>
                            </div>
                            <div className="max-h-80 overflow-auto p-2 space-y-2">
                                {ytSnapshotItems.map((it, idx) => {
                                    const key = it.postId || it.id || it.url || String(idx)
                                    const checked = !!ytSelectedIds[key]
                                    return (
                                        <div key={key} className="border rounded p-2 flex items-start gap-3">
                                            <input type="checkbox" checked={checked} onChange={(e) => setYtSelectedIds(prev => ({ ...prev, [key]: e.target.checked }))} />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs text-muted-foreground">{it.platform} | {it.keyword}</div>
                                                <div className="text-sm font-medium truncate break-all">{it.title || it.url}</div>
                                                <div className="text-xs text-muted-foreground break-all">{it.url}</div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                        {(['tiktok', 'youtube', 'twitter', 'instagram'] as const).map(p => (
                            <div key={p} className="p-3 border rounded-md">
                                <div className="text-xs text-muted-foreground mb-1">{p.toUpperCase()}</div>
                                <div className="flex items-center gap-2">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${jobStages[p].status === 'done' ? 'bg-green-100 text-green-700' : jobStages[p].status === 'running' ? 'bg-blue-100 text-blue-700' : jobStages[p].status === 'error' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{jobStages[p].status}</span>
                                    <span className="text-xs text-muted-foreground">items: {jobStages[p].items}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    {items.length === 0 ? (
                        <div className="text-center text-muted-foreground py-10">暂无数据，请先触发抓取</div>
                    ) : (
                        <div className="space-y-3">
                            {items.map((item) => (
                                <div key={item.postId || item.id} className="border rounded-lg p-4">
                                    <div className="space-y-3">
                                        {/* 基础信息行 */}
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div className="md:col-span-3 space-y-1 min-w-0">
                                                <div className="text-sm text-muted-foreground break-all">平台: {item.platform}</div>
                                                <div className="font-medium break-all">标题: {item.title || item.url}</div>
                                                <div className="text-sm text-muted-foreground break-all">作者: {item.author}</div>
                                                <div className="text-sm text-muted-foreground break-all">关键词: {item.keyword}</div>
                                                <div className="text-sm text-muted-foreground break-all">链接: <a className="underline" href={item.url} target="_blank" rel="noreferrer">{item.url}</a></div>
                                                <div className="text-sm text-muted-foreground break-all">发布时间: {String(item.published_at || '')}</div>
                                                <div className="text-sm text-muted-foreground break-all">抓取时间: {String(item.fetched_at || '')}</div>
                                                {typeof item.score === 'number' && (
                                                    <div className="text-sm text-muted-foreground break-all">热度分数: {Math.round((item.score || 0) * 100) / 100}</div>
                                                )}
                                            </div>
                                            <div className="md:col-span-1 flex flex-col items-end gap-2">
                                                <div className="text-xs text-muted-foreground">❤ {item.likes}  💬 {item.comments}  🔁 {item.shares}  👀 {item.views}</div>
                                                <div className="text-xs text-muted-foreground">粉丝: {item.followers}</div>
                                                <div className="flex items-center gap-2">
                                                    <Button size="sm" variant="outline" onClick={() => window.open(item.url, '_blank')}>
                                                        <LinkIcon className="h-4 w-4 mr-1" />
                                                        打开链接
                                                    </Button>
                                                    <Button size="sm" onClick={() => importToWorkflow(item)}>
                                                        <PlusCircle className="h-4 w-4 mr-1" />
                                                        导入工作流
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* 描述内容 */}
                                        {item.desc && (
                                            <div className="border-t pt-2">
                                                <div className="text-sm font-medium mb-1">描述内容:</div>
                                                <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words bg-gray-50 p-2 rounded">
                                                    {item.desc}
                                                </div>
                                            </div>
                                        )}

                                        {/* 原始数据展示 */}
                                        <details className="border-t pt-2">
                                            <summary className="text-sm font-medium cursor-pointer hover:text-blue-600">
                                                📊 查看完整原始数据
                                            </summary>
                                            <div className="mt-2 text-xs bg-gray-100 p-3 rounded overflow-auto max-h-60">
                                                <pre className="whitespace-pre-wrap break-words">
                                                    {JSON.stringify(item, null, 2)}
                                                </pre>
                                            </div>
                                        </details>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 选题发现记录与导出 */}
            <Card>
                <CardHeader>
                    <CardTitle>选题发现记录</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-sm text-muted-foreground">最近 50 次触发记录</div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                onClick={async () => {
                                    try {
                                        const r = await listSourcingRuns(50)
                                        setRuns(r.items || [])
                                    } catch { }
                                }}
                            >刷新</Button>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    try {
                                        const header = ['ID', '平台', '关键词', '条数', '时间']
                                        const rows = runs.map(r => [
                                            r.id,
                                            (r.platforms || []).join(';'),
                                            (r.keywords || []).join(';'),
                                            String(r.count || 0),
                                            String(r.started_at || '')
                                        ])
                                        const csv = [header, ...rows]
                                            .map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
                                            .join('\n')
                                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                                        const url = URL.createObjectURL(blob)
                                        const a = document.createElement('a')
                                        a.href = url
                                        a.download = `sourcing_runs_${Date.now()}.csv`
                                        a.click()
                                        URL.revokeObjectURL(url)
                                    } catch { }
                                }}
                            >导出 CSV</Button>
                        </div>
                    </div>
                    {runs.length === 0 ? (
                        <div className="text-sm text-muted-foreground">暂无记录</div>
                    ) : (
                        <div className="overflow-auto border rounded">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="text-left p-2">平台</th>
                                        <th className="text-left p-2">关键词</th>
                                        <th className="text-left p-2">条数</th>
                                        <th className="text-left p-2">时间</th>
                                        <th className="text-left p-2">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {runs.map(r => (
                                        <tr key={r.id} className={`border-t ${activeRunId === r.id ? 'bg-blue-50' : ''}`}>
                                            <td className="p-2 break-all">{(r.platforms || []).join(', ')}</td>
                                            <td className="p-2 break-all">{(r.keywords || []).join(', ')}</td>
                                            <td className="p-2">{r.count}</td>
                                            <td className="p-2 break-all">{String(r.started_at || '')}</td>
                                            <td className="p-2">
                                                <div className="flex items-center gap-2">
                                                    <Button size="sm" variant="outline" disabled={loading} onClick={async () => {
                                                        try {
                                                            setActiveRunId(r.id)
                                                            // 设置当前查看的运行ID
                                                            const { fetchLatestPosts } = await import('@/services/sourcingService')
                                                            const { items: all } = await fetchLatestPosts({ platform: 'all', runId: r.id })
                                                            setItems(all || [])
                                                        } catch { }
                                                    }}>查看该次</Button>
                                                    <Button size="sm" variant="destructive" disabled={loading} onClick={async () => {
                                                        if (!confirm('确认删除该次选题记录及其关联的所有抓取数据？此操作不可撤销。')) return
                                                        try {
                                                            setLoading(true)
                                                            const { deleteSourcingRun, listSourcingRuns } = await import('@/services/sourcingService')
                                                            await deleteSourcingRun(r.id)
                                                            // 从前端列表移除
                                                            setRuns(prev => prev.filter(x => x.id !== r.id))
                                                            if (activeRunId === r.id) {
                                                                setActiveRunId('')
                                                                setItems([])
                                                            }
                                                            // 可选：刷新服务端列表，确保一致
                                                            try {
                                                                const refreshed = await listSourcingRuns(100)
                                                                const items = (refreshed as any).runs || (refreshed as any).items || []
                                                                setRuns(items)
                                                            } catch { /* 忽略刷新失败 */ }
                                                        } catch (e) {
                                                            alert('删除失败：' + (e as Error).message)
                                                        } finally {
                                                            setLoading(false)
                                                        }
                                                    }}>删除</Button>
                                                    <Button size="sm" variant="secondary" disabled={loading} onClick={async () => {
                                                        try {
                                                            const { fetchLatestPosts } = await import('@/services/sourcingService')
                                                            const exportOne = async (platform: 'tiktok' | 'youtube' | 'twitter' | 'instagram') => {
                                                                const { items: rows } = await fetchLatestPosts({ platform, runId: r.id, page: 1, pageSize: 1000 })
                                                                if (!rows || rows.length === 0) return { platform, ok: false }
                                                                const header = ['platform', 'keyword', 'author', 'url', 'title', 'desc', 'published_at', 'fetched_at', 'likes', 'comments', 'shares', 'views', 'followers']
                                                                const esc = (s: any) => `"${String(s ?? '').replace(/\"/g, '""')}"`
                                                                const csv = [header.join(',')].concat(
                                                                    rows.map((x: any) => [x.platform, x.keyword, x.author, x.url, x.title, x.desc, String(x.published_at || ''), String(x.fetched_at || ''), Number(x.likes || 0), Number(x.comments || 0), Number(x.shares || 0), Number(x.views || 0), Number(x.followers || 0)].map(esc).join(','))
                                                                ).join('\n')
                                                                const csvWithBom = '\ufeff' + csv
                                                                const blob = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' })
                                                                const url = URL.createObjectURL(blob)
                                                                const a = document.createElement('a')
                                                                a.href = url
                                                                a.download = `sourcing_run_${r.id}_${platform}.csv`
                                                                a.click()
                                                                URL.revokeObjectURL(url)
                                                                return { platform, ok: true }
                                                            }

                                                            const chosen = (r.platforms || []) as Array<'tiktok' | 'youtube' | 'twitter' | 'instagram'>
                                                            if (chosen.length === 0) { alert('该次未记录平台信息'); return }
                                                            const results = [] as any[]
                                                            for (const p of chosen) {
                                                                // 逐个平台导出
                                                                const res = await exportOne(p)
                                                                results.push(res)
                                                            }
                                                            const ok = results.some(x => x && x.ok)
                                                            if (!ok) alert('没有可导出的数据')
                                                        } catch { alert('导出失败，请稍后再试') }
                                                    }}>导出各平台 CSV</Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}


