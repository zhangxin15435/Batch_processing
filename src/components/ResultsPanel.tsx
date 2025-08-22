import React, { useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Download, Eye, Image, FileText, Sparkles, Copy, ExternalLink, UploadCloud, Database, Loader2, ChevronDown, ChevronUp, Cloud } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppStore } from '@/stores/appStore'
import { WorkflowStep, FileStatus } from '@/types'
import { formatFileSize, downloadFile, downloadImage, formatRelativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { createLarkRecord } from '@/services/larkService'
import { APIService } from '@/services/apiService'
import { saveContentRecord, listContent, getContentByKey } from '@/services/contentService'
import { mapContentToRecord } from '@/lib/contentMapper'

export const ResultsPanel: React.FC = () => {
    const { files, tasks, config } = useAppStore()
    const [selectedResult, setSelectedResult] = useState<any>(null)
    const [previewOpen, setPreviewOpen] = useState(false)
    // 移除旧的禁用控制，改为细粒度进度提示
    const [dbRecords, setDbRecords] = useState<any[]>([])
    const [loadingRecords, setLoadingRecords] = useState(false)

    // 收缩/展开状态管理
    const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({})

    // 切换任务展开/收缩状态
    const toggleTaskExpanded = (taskId: string) => {
        setExpandedTasks(prev => ({
            ...prev,
            [taskId]: !prev[taskId]
        }))
    }

    // 进度状态：key -> { done, total, label }
    const [uploadingProgress, setUploadingProgress] = useState<Record<string, { done: number; total: number; label: string }>>({})

    // 开始某个任务的进度
    const beginProgress = (key: string, total: number, label: string) => {
        setUploadingProgress(prev => ({ ...prev, [key]: { done: 0, total: Math.max(1, total), label } }))
    }
    // 单步前进
    const stepProgress = (key: string) => {
        setUploadingProgress(prev => {
            const current = prev[key]
            if (!current) return prev
            const nextDone = Math.min(current.total, current.done + 1)
            return { ...prev, [key]: { ...current, done: nextDone } }
        })
    }
    // 结束并移除该进度
    const endProgress = (key: string) => {
        setUploadingProgress(prev => {
            const next = { ...prev }
            delete next[key]
            return next
        })
    }
    // 渲染带进度的按钮内容
    const renderProgressLabel = (key: string, defaultLabel: string): React.ReactNode => {
        const p = uploadingProgress[key]
        if (!p) return defaultLabel
        if (p.total > 1) {
            return (
                <span className="flex items-center">
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    {`${p.label} ${p.done}/${p.total}`}
                </span>
            )
        }
        return (
            <span className="flex items-center">
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                {`${p.label}...`}
            </span>
        )
    }

    // 获取已完成的任务
    const completedTasks = tasks.filter(task =>
        task.status === FileStatus.COMPLETED && task.results.length > 0
    )
    const hasCompleted = completedTasks.length > 0

    // 加载数据库记录
    const loadDbRecords = async () => {
        try {
            setLoadingRecords(true)
            const records = await listContent(50) // 获取最近50条记录
            setDbRecords(records)
        } catch (e) {
            console.error('加载数据库记录失败:', e)
        } finally {
            setLoadingRecords(false)
        }
    }

    // 组件挂载时加载数据库记录；并在无任务时默认展示数据库页签
    useEffect(() => {
        loadDbRecords()
    }, [])

    const handleDownloadResult = (content: string, filename: string, isImage = false) => {
        if (isImage) {
            downloadImage(content, filename)
        } else {
            downloadFile(content, filename)
        }
    }

    const handleDownloadAll = () => {
        // 批量下载所有结果；若图片步骤包含两张图，全部下载
        completedTasks.forEach(task => {
            const file = files.find(f => f.id === task.fileId)
            if (!file) return

            const baseFilename = file.name.replace(/\.[^/.]+$/, '')

            task.results.forEach(result => {
                if (result.step === WorkflowStep.IMAGE_GENERATION && (result.metadata as any)?.images?.length) {
                    // 下载两张图片
                    const images = (result.metadata as any).images as Array<any>
                    images.forEach((img: any, idx: number) => {
                        const suffix = img.kind === 'youtube' ? 'youtube_thumb' : img.kind === 'instagram' ? 'instagram_cover' : `image_${idx + 1}`
                        downloadImage(img.url, `${baseFilename}_${suffix}.png`)
                    })
                } else if (result.step === WorkflowStep.IMAGE_GENERATION) {
                    // 兼容旧数据，只有一张图
                    downloadImage(result.content, `${baseFilename}_cover_image.png`)
                } else if (result.step === WorkflowStep.CONTENT_GENERATION) {
                    downloadFile(result.content, `${baseFilename}_content_strategy.md`)
                } else if (result.step === WorkflowStep.DOCUMENT_GENERATION) {
                    downloadFile(result.content, `${baseFilename}_documentation.md`)
                }
            })
        })
    }

    // —— Lark 上传 ——
    // 旧的片段提取与 slugify 在新的飞书上传流程中已不使用
    // 删除未使用函数以避免告警

    const apiService = new APIService((useAppStore.getState().config as any).api)

    // 抽取公共上传逻辑：支持按钮选择与拖拽两种入口复用
    const processUploadImages = async (taskId: string, field: 'Cover' | 'Example_Output', files: File[]) => {
        if (!files || files.length === 0) return
        const progressKey = `${field === 'Cover' ? 'cover' : 'example'}-${taskId}`
        beginProgress(progressKey, files.length, field === 'Cover' ? '上传封面' : '上传示例')
        try {
            // 读取任务的背景索引，确保同一任务的示例图背景一致
            const taskForBg = tasks.find(t => t.id === taskId)
            const bgIndex = taskForBg?.bgIndex

            // 并发上传所有文件；每个文件完成后推进一次进度
            const uploadPromises = files.map((f) => (async () => {
                if (field === 'Example_Output') {
                    // 读取为 DataURL 发送到后端合成
                    const dataUrl = await (new Promise<string>((resolve, reject) => {
                        const reader = new FileReader()
                        reader.onload = () => resolve(String(reader.result || ''))
                        reader.onerror = () => reject(new Error('读取文件失败'))
                        reader.readAsDataURL(f)
                    }))
                    const endpoint = config.imageUploadEndpoint || '/api/v1/upload'
                    const apiKey = config.imageUploadApiKey || ''
                    const r = await fetch('/api/image/upload-with-bg', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            filename: f.name,
                            mime: f.type,
                            data: dataUrl,
                            endpoint,
                            apiKey,
                            ...(typeof bgIndex === 'number' ? { bgIndex } : {})
                        })
                    })
                    const payload = await r.json().catch(() => ({}))
                    if (!r.ok || !payload?.success || !payload?.data?.url) {
                        throw new Error(payload?.error || '合成上传失败')
                    }
                    return payload.data.url as string
                } else {
                    const url = await apiService.uploadImageToHosting(f)
                    return url
                }
            })().then((url) => {
                // 成功与失败都推进进度，失败在汇总时统一处理
                stepProgress(progressKey)
                return url
            }).catch((err) => {
                stepProgress(progressKey)
                throw err
            }))

            const results = await Promise.allSettled(uploadPromises)
            const hasRejected = results.some(r => r.status === 'rejected')
            if (hasRejected) {
                const firstErr = results.find(r => r.status === 'rejected') as PromiseRejectedResult
                throw new Error((firstErr?.reason?.message) || String(firstErr?.reason || '上传失败'))
            }

            const urls: string[] = (results as PromiseFulfilledResult<string>[]).map(r => (r as any).value as string)

            // 从任务中取 Markdown 并映射，再写入图片字段
            const task = tasks.find(t => t.id === taskId)
            if (!task) throw new Error('未找到任务')
            const contentMd = task.results.find(r => r.step === WorkflowStep.CONTENT_GENERATION)?.content || ''
            const payload = (mapContentToRecord as any)(contentMd, { Type: 'workflow' })
                // 强绑定：一文件一记录，使用 fileId 作为稳定 Record_ID
                ; (payload as any).Record_ID = `rec_${task.fileId}`

            // 读取数据库记录（优先按 id，其次按 Title）做字段合并：确保每次上传的 URL 都被累计保存
            let joined = urls.join(',')
            const coverUrl = urls[0] || ''
            try {
                const recent = await listContent(200)
                const arr = Array.isArray(recent) ? recent : []
                const matchedById = arr.find((r: any) => String(r.id || '') === String(`rec_${task.fileId}`))
                const matchedByTitle = arr.find((r: any) => String(r.Title || '').trim() === String(payload.Title || '').trim())
                const matched = matchedById || matchedByTitle
                if (matched) {
                    const toArr = (v: any): string[] => Array.isArray(v)
                        ? v
                        : (typeof v === 'string' && v.trim())
                            ? v.split(',').map((s: string) => s.trim()).filter(Boolean)
                            : []
                    if (field === 'Example_Output') {
                        const existing = toArr((matched as any).Example_Output)
                        const merged = Array.from(new Set([...existing, ...urls]))
                        joined = merged.join(',')
                    }
                    // Cover：按需求只保留第一张，使用本次的首张覆盖
                }
            } catch { }

            if (field === 'Cover') {
                ; (payload as any)['Cover'] = coverUrl
            } else {
                ; (payload as any)['Example_Output'] = joined
            }

            // 仅保存到数据库，不进行上传到多维
            await (saveContentRecord as any)(payload)
            // 成功上传不再显示提示，只在控制台记录
            console.log(`${field} 已上传到图床并写入数据库：`, field === 'Cover' ? coverUrl : urls.join(', '))
        } catch (e: any) {
            alert(`上传图片失败：${e?.message || e}`)
        } finally {
            endProgress(progressKey)
        }
    }

    const handleUploadToLark = async (taskId: string) => {
        try {
            const progressKey = `lark-${taskId}`
            beginProgress(progressKey, 1, '上传到多维')
            const task = tasks.find(t => t.id === taskId)
            if (!task) throw new Error('未找到任务')

            // 优先：从数据库读取该任务对应记录
            const dbItem = (await getContentByKey({ recordId: task.recordId })) || null

            let payload: any
            if (dbItem) {
                payload = {
                    Title: dbItem.title || dbItem.Title,
                    Slug: dbItem.slug || dbItem.Slug,
                    Description: dbItem.description || dbItem.Description,
                    Usage_Guide: dbItem.usage_guide || dbItem.Usage_Guide,
                    like: dbItem.like || dbItem.Like,
                    Title_CN: dbItem.title_cn || dbItem.Title_CN,
                    Description_CN: dbItem.description_cn || dbItem.Description_CN,
                    Usage_Guide_CN: dbItem.usage_guide_cn || dbItem.Usage_Guide_CN,
                    Category: dbItem.category || dbItem.Category,
                    Type: dbItem.type || dbItem.Type,
                    status: dbItem.status || dbItem.Status,
                    Cover: dbItem.cover || dbItem.Cover,
                    Example_Output: dbItem.example_output || dbItem.Example_Output,
                    Record_ID: dbItem.id || dbItem.Record_ID,
                }
            } else {
                // 兜底：从任务内容解析
                const contentMd = task.results.find(r => r.step === WorkflowStep.CONTENT_GENERATION)?.content || ''
                if (!contentMd) throw new Error('未找到内容生成结果')
                payload = (mapContentToRecord as any)(contentMd, '', { Type: 'workflow' })
                if (task.recordId) (payload as any).Record_ID = task.recordId
            }

            // 读取最近数据库记录，聚合同 Title 的相关记录
            try {
                const recent = await listContent(200)
                const same = Array.isArray(recent)
                    ? recent.filter((r: any) => String(r.Title || '').trim() === String(payload.Title || '').trim())
                    : []
                if (same.length > 0) {
                    const toArr = (v: any): string[] => Array.isArray(v)
                        ? v
                        : (typeof v === 'string' && v.trim())
                            ? String(v).split(',').map(s => s.trim()).filter(Boolean)
                            : []
                    const allEx: string[] = []
                    for (const it of same) allEx.push(...toArr((it as any).Example_Output))
                    const uniqEx = Array.from(new Set(allEx))
                    if (uniqEx.length > 0) (payload as any).Example_Output = uniqEx.join(',')

                    const parseTime = (s: any) => {
                        const d = new Date(String(s))
                        return isNaN(d.getTime()) ? 0 : d.getTime()
                    }
                    const latestCover = [...same]
                        .sort((a, b) => parseTime(b.created_at) - parseTime(a.created_at))
                        .map((r: any) => (typeof r.Cover === 'string' ? r.Cover : Array.isArray(r.Cover) ? r.Cover[0] : ''))
                        .map((s: string) => String(s || '').trim())
                        .find((s: string) => !!s)
                    if (latestCover) (payload as any).Cover = latestCover
                }
            } catch { /* ignore */ }

            await (saveContentRecord as any)(payload)

            const allowedCategories = [
                'Lifestyle', 'Job hunting', 'Creation', 'Marketing', 'Sales', 'Business', 'Programming', 'Funny', 'ASMR', 'Game', 'Image'
            ]
            const normalizeFromList = (value?: string, list: string[] = []): string | undefined => {
                if (!value) return undefined
                const v = value.trim().toLowerCase()
                const hit = list.find(item => item.toLowerCase() === v)
                return hit || undefined
            }
            const normalizeType = (value?: string): string | undefined => {
                if (!value) return undefined
                const v = value.trim().toLowerCase()
                if (v === 'prompt') return 'prompt'
                if (v === 'workflow') return 'workflow'
                if (v === 'all') return 'all'
                return undefined
            }
            const normalizeStatus = (value?: string): string | undefined => {
                if (!value) return 'draft'
                const v = value.trim().toLowerCase()
                if (v === 'draft') return 'draft'
                if (v === 'online') return 'online'
                if (v === 'offline') return 'offline'
                return 'draft'
            }

            const normalizedCategory = normalizeFromList(payload.Category, allowedCategories)
            const normalizedType = normalizeType(payload.Type)
            const normalizedStatus = normalizeStatus(payload.status)

            const record: Record<string, any> = {
                Title: payload.Title || 'Untitled',
                Slug: payload.Slug || '',
                Description: payload.Description || payload.Description_CN || '',
                Usage_Guide: payload.Usage_Guide || payload.Usage_Guide_CN || '',
                Like: payload.like,
                Title_CN: payload.Title_CN || '',
                Description_CN: payload.Description_CN || '',
                Usage_Guide_CN: payload.Usage_Guide_CN || '',
                ...(normalizedType ? { Type: normalizedType } : {}),
                ...(normalizedCategory ? { Category: [normalizedCategory] } : {}),
                ...(normalizedStatus ? { Status: normalizedStatus } : {}),
                ...((payload as any).Cover ? { Cover: (() => { const first = String((payload as any).Cover).split(',').map((s: string) => s.trim()).filter(Boolean)[0]; return first ? { text: first, link: first } : undefined })() } : {}),
                ...((payload as any).Example_Output ? { Example_Output: String((payload as any).Example_Output) } : {})
            }

            try {
                await createLarkRecord(record)
            } catch (err) {
                const minimal: Record<string, any> = {
                    Title: record.Title || 'Untitled',
                    ...(payload.Slug ? { Slug: payload.Slug } : {}),
                    ...(record.Description ? { Description: record.Description } : {}),
                    ...((payload as any).Cover ? { Cover: (() => { const first = String((payload as any).Cover).split(',').map((s: string) => s.trim()).filter(Boolean)[0]; return first ? { text: first, link: first } : undefined })() } : {}),
                    ...((payload as any).Example_Output ? { Example_Output: String((payload as any).Example_Output) } : {})
                }
                await createLarkRecord(minimal)
            }
            console.log('已上传到多维表格')
        } catch (e: any) {
            alert(`上传失败：${e?.message || e}`)
        } finally {
            const progressKey = `lark-${taskId}`
            endProgress(progressKey)
        }
    }

    // 下载该图片步骤的两张图
    const downloadImagePair = (result: any, baseFilename: string) => {
        const images = (result.metadata as any)?.images as Array<any> | undefined
        if (images && images.length > 0) {
            images.forEach((img: any, idx: number) => {
                const suffix = img.kind === 'youtube' ? 'youtube_thumb' : img.kind === 'instagram' ? 'instagram_cover' : `image_${idx + 1}`
                // 增加少量延迟避免被浏览器拦截
                setTimeout(() => downloadImage(img.url, `${baseFilename}_${suffix}.png`), idx * 300)
            })
        } else {
            downloadImage(result.content, `${baseFilename}_cover_image.png`)
        }
    }

    // —— 新增：上传图片到图床并回写 ——
    const handleUploadImages = async (taskId: string, field: 'Cover' | 'Example_Output') => {
        try {
            // 旧：设置禁用；现：仅用进度提示
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = 'image/*'
            input.multiple = true
            const filePick = await new Promise<File[]>((resolve) => {
                input.onchange = () => {
                    const files = Array.from(input.files || [])
                    resolve(files)
                }
                input.click()
            })
            if (!filePick.length) return
            await processUploadImages(taskId, field, filePick)
        } catch (e: any) {
            alert(`上传图片失败：${e?.message || e}`)
        } finally { /* 进度在 processUploadImages 中统一处理 */ }
    }

    // 批量上传所有已完成任务到多维表格
    const handleBatchUploadToLark = async () => {
        const completedTasksToUpload = completedTasks.filter(task => task.results.length > 0)

        if (completedTasksToUpload.length === 0) {
            alert('没有可上传的任务')
            return
        }

        // 确认对话框
        const fileNames = completedTasksToUpload.map(task => {
            const file = files.find(f => f.id === task.fileId)
            return file?.name || task.id
        }).slice(0, 5) // 只显示前5个文件名

        const confirmMessage = `确定要将 ${completedTasksToUpload.length} 个已完成的任务批量上传到多维表格吗？\n\n包含文件：\n${fileNames.join('\n')}${completedTasksToUpload.length > 5 ? '\n...' : ''}\n\n注意：此操作不可撤销`

        if (!confirm(confirmMessage)) {
            return
        }

        const progressKey = 'batch-lark-upload'
        beginProgress(progressKey, completedTasksToUpload.length, '批量上传到多维')

        let successCount = 0
        let errorCount = 0
        const errors: string[] = []

        try {
            for (const task of completedTasksToUpload) {
                try {
                    // 复用现有的上传逻辑，但不显示单个任务的弹窗
                    const taskToProcess = tasks.find(t => t.id === task.id)
                    if (!taskToProcess) {
                        throw new Error('未找到任务')
                    }

                    const contentMd = taskToProcess.results.find(r => r.step === WorkflowStep.CONTENT_GENERATION)?.content || ''
                    if (!contentMd) {
                        throw new Error('未找到内容生成结果')
                    }

                    // 使用统一的映射器解析 AI 输出
                    const payload = (mapContentToRecord as any)(contentMd, '', { Type: 'workflow' })
                    if (taskToProcess.recordId) (payload as any).Record_ID = taskToProcess.recordId

                    // 聚合数据库记录信息
                    try {
                        const recent = await listContent(200)
                        const same = Array.isArray(recent)
                            ? recent.filter((r: any) => String(r.Title || '').trim() === String(payload.Title || '').trim())
                            : []
                        if (same.length > 0) {
                            const toArr = (v: any): string[] => Array.isArray(v)
                                ? v
                                : (typeof v === 'string' && v.trim())
                                    ? String(v).split(',').map(s => s.trim()).filter(Boolean)
                                    : []
                            const allEx: string[] = []
                            for (const it of same) allEx.push(...toArr((it as any).Example_Output))
                            const uniqEx = Array.from(new Set(allEx))
                            if (uniqEx.length > 0) (payload as any).Example_Output = uniqEx.join(',')

                            const parseTime = (s: any) => {
                                const d = new Date(String(s))
                                return isNaN(d.getTime()) ? 0 : d.getTime()
                            }
                            const latestCover = [...same]
                                .sort((a, b) => parseTime(b.created_at) - parseTime(a.created_at))
                                .map((r: any) => (typeof r.Cover === 'string' ? r.Cover : Array.isArray(r.Cover) ? r.Cover[0] : ''))
                                .map((s: string) => String(s || '').trim())
                                .find((s: string) => !!s)
                            if (latestCover) (payload as any).Cover = latestCover
                        }
                    } catch { /* ignore */ }

                    // 先保存到数据库
                    await (saveContentRecord as any)(payload)

                    // 字段类型适配
                    const allowedCategories = [
                        'Lifestyle', 'Job hunting', 'Creation', 'Marketing', 'Sales', 'Business', 'Programming', 'Funny', 'ASMR', 'Game', 'Image'
                    ]
                    const normalizeFromList = (value?: string, list: string[] = []): string | undefined => {
                        if (!value) return undefined
                        const v = value.trim().toLowerCase()
                        const hit = list.find(item => item.toLowerCase() === v)
                        return hit || undefined
                    }
                    const normalizeType = (value?: string): string | undefined => {
                        if (!value) return undefined
                        const v = value.trim().toLowerCase()
                        if (v === 'prompt') return 'prompt'
                        if (v === 'workflow') return 'workflow'
                        if (v === 'all') return 'all'
                        return undefined
                    }
                    const normalizeStatus = (value?: string): string | undefined => {
                        if (!value) return 'draft'
                        const v = value.trim().toLowerCase()
                        if (v === 'draft') return 'draft'
                        if (v === 'online') return 'online'
                        if (v === 'offline') return 'offline'
                        return 'draft'
                    }

                    const normalizedCategory = normalizeFromList(payload.Category, allowedCategories)
                    const normalizedType = normalizeType(payload.Type)
                    const normalizedStatus = normalizeStatus(payload.status)

                    // 构建上传记录
                    const record: Record<string, any> = {
                        Title: payload.Title || 'Untitled',
                        Slug: payload.Slug || '',
                        Description: payload.Description || payload.Description_CN || '',
                        Usage_Guide: payload.Usage_Guide || payload.Usage_Guide_CN || '',
                        Like: payload.like,
                        Title_CN: payload.Title_CN || '',
                        Description_CN: payload.Description_CN || '',
                        Usage_Guide_CN: payload.Usage_Guide_CN || '',
                        ...(normalizedType ? { Type: normalizedType } : {}),
                        ...(normalizedCategory ? { Category: [normalizedCategory] } : {}),
                        ...(normalizedStatus ? { Status: normalizedStatus } : {}),
                        ...((payload as any).Cover ? { Cover: (() => { const first = String((payload as any).Cover).split(',').map((s: string) => s.trim()).filter(Boolean)[0]; return first ? { text: first, link: first } : undefined })() } : {}),
                        ...((payload as any).Example_Output ? { Example_Output: String((payload as any).Example_Output) } : {})
                    }

                    try {
                        await createLarkRecord(record)
                    } catch (err) {
                        // 尝试简化记录重新上传
                        const minimal: Record<string, any> = {
                            Title: record.Title || 'Untitled',
                            ...(payload.Slug ? { Slug: payload.Slug } : {}),
                            ...(record.Description ? { Description: record.Description } : {}),
                            ...((payload as any).Cover ? { Cover: (() => { const first = String((payload as any).Cover).split(',').map((s: string) => s.trim()).filter(Boolean)[0]; return first ? { text: first, link: first } : undefined })() } : {}),
                            ...((payload as any).Example_Output ? { Example_Output: String((payload as any).Example_Output) } : {})
                        }
                        await createLarkRecord(minimal)
                    }

                    successCount++
                    stepProgress(progressKey)
                } catch (error: any) {
                    errorCount++
                    const file = files.find(f => f.id === task.fileId)
                    errors.push(`${file?.name || task.id}: ${error?.message || error}`)
                    stepProgress(progressKey)
                }
            }

            // 显示结果统计
            if (errorCount === 0) {
                console.log(`批量上传完成：成功 ${successCount} 个任务`)
            } else {
                alert(`批量上传完成！\n成功: ${successCount} 个\n失败: ${errorCount} 个\n\n失败详情：\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? '\n...' : ''}`)
            }
        } catch (error: any) {
            alert(`批量上传失败：${error?.message || error}`)
        } finally {
            endProgress(progressKey)
        }
    }

    const copyToClipboard = async (text: string, event?: React.MouseEvent) => {
        try {
            await navigator.clipboard.writeText(text)
            // 显示成功提示
            if (event) {
                const button = event.currentTarget as HTMLButtonElement
                const originalTitle = button.title || '复制'
                button.title = '已复制！'
                setTimeout(() => {
                    button.title = originalTitle
                }, 2000)
            }
            console.log('复制成功')
        } catch (err) {
            console.error('复制失败:', err)
            // 降级方案：使用传统方法复制
            try {
                const textarea = document.createElement('textarea')
                textarea.value = text
                document.body.appendChild(textarea)
                textarea.select()
                document.execCommand('copy')
                document.body.removeChild(textarea)
                console.log('使用降级方案复制成功')
                alert('内容已复制到剪贴板')
            } catch (fallbackErr) {
                console.error('降级复制也失败:', fallbackErr)
                alert('复制失败，请手动选择并复制内容')
            }
        }
    }

    const getStepIcon = (step: WorkflowStep) => {
        switch (step) {
            case WorkflowStep.CONTENT_GENERATION:
                return <Sparkles className="h-4 w-4" />
            case WorkflowStep.IMAGE_GENERATION:
                return <Image className="h-4 w-4" />
            case WorkflowStep.DOCUMENT_GENERATION:
                return <FileText className="h-4 w-4" />
            default:
                return <FileText className="h-4 w-4" />
        }
    }

    const getStepName = (step: WorkflowStep) => {
        switch (step) {
            case WorkflowStep.CONTENT_GENERATION:
                return '内容创意'
            case WorkflowStep.IMAGE_GENERATION:
                return '封面图片'
            case WorkflowStep.DOCUMENT_GENERATION:
                return 'MD文档'
            default:
                return '未知'
        }
    }

    const getStepColor = (step: WorkflowStep) => {
        switch (step) {
            case WorkflowStep.CONTENT_GENERATION:
                return 'text-purple-600 bg-purple-50'
            case WorkflowStep.IMAGE_GENERATION:
                return 'text-blue-600 bg-blue-50'
            case WorkflowStep.DOCUMENT_GENERATION:
                return 'text-green-600 bg-green-50'
            default:
                return 'text-gray-600 bg-gray-50'
        }
    }

    // 不再在“无任务”时提前返回，改为默认展示“数据库记录”页签

    return (
        <div className="space-y-6">
            <Tabs defaultValue={completedTasks.length > 0 ? 'workflow' : 'database'} className="w-full">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                    <TabsList className="grid w-full max-w-md grid-cols-2 order-2 md:order-1">
                        <TabsTrigger value="workflow">工作流结果</TabsTrigger>
                        <TabsTrigger value="database">数据库记录</TabsTrigger>
                    </TabsList>
                    <div className="flex items-center gap-2 order-1 md:order-2">
                        <Button onClick={handleDownloadAll} variant="outline" size="sm">
                            <Download className="h-4 w-4 mr-2" />
                            下载全部
                        </Button>
                        {completedTasks.length > 0 && (
                            <Button onClick={handleBatchUploadToLark} variant="gradient" size="sm" className="whitespace-nowrap">
                                <Cloud className="h-4 w-4 mr-2" />
                                {renderProgressLabel('batch-lark-upload', '一键上传到多维')}
                            </Button>
                        )}
                    </div>
                </div>

                <TabsContent value="workflow" className="space-y-6">
                    {/* 结果概览 */}
                    <Card className="card-hover">
                        <CardHeader>
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <CardTitle className="flex items-center gap-2">
                                    📊 处理结果概览
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    <Button onClick={handleDownloadAll} variant="gradient" className="whitespace-nowrap">
                                        <Download className="h-4 w-4 mr-2" />
                                        下载所有结果
                                    </Button>
                                    <Button onClick={handleBatchUploadToLark} variant="outline" className="whitespace-nowrap">
                                        <Cloud className="h-4 w-4 mr-2" />
                                        {renderProgressLabel('batch-lark-upload', '批量上传到多维')}
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="text-center p-4 rounded-lg bg-gradient-to-br from-purple-50 to-purple-100">
                                    <div className="text-3xl font-bold text-purple-600">{completedTasks.length}</div>
                                    <div className="text-sm text-purple-600">已完成任务</div>
                                </div>
                                <div className="text-center p-4 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100">
                                    <div className="text-3xl font-bold text-blue-600">
                                        {completedTasks.reduce((sum, task) => sum + task.results.length, 0)}
                                    </div>
                                    <div className="text-sm text-blue-600">生成结果数</div>
                                </div>
                                <div className="text-center p-4 rounded-lg bg-gradient-to-br from-green-50 to-green-100">
                                    <div className="text-3xl font-bold text-green-600">
                                        {completedTasks.filter(task =>
                                            task.results.some(r => r.step === WorkflowStep.IMAGE_GENERATION)
                                        ).length}
                                    </div>
                                    <div className="text-sm text-green-600">生成图片数</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 结果列表（优先显示本次会话已完成任务；若无，则显示最近保存的数据库记录） */}
                    {hasCompleted ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {completedTasks.map(task => {
                                const file = files.find(f => f.id === task.fileId)
                                if (!file) return null

                                // 为每个任务预解析记录以展示
                                const contentMd = task.results.find(r => r.step === WorkflowStep.CONTENT_GENERATION)?.content || ''
                                const parsedRecord = ((): any => {
                                    try { return (mapContentToRecord as any)(contentMd, { Title: file.name }) } catch { return null }
                                })()

                                return (
                                    <Card key={task.id} className="card-hover">
                                        <CardHeader>
                                            <div className="flex flex-col md:flex-row md:items-center gap-3 min-w-0">
                                                <div className="text-2xl">📄</div>
                                                <div className="flex-1 min-w-0">
                                                    <CardTitle className="text-lg truncate flex items-center gap-2">
                                                        {file.name}
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => toggleTaskExpanded(task.id)}
                                                            className="shrink-0 p-1 h-6 w-6"
                                                        >
                                                            {expandedTasks[task.id] ? (
                                                                <ChevronUp className="h-4 w-4" />
                                                            ) : (
                                                                <ChevronDown className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </CardTitle>
                                                    <p className="text-sm text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                                                        完成时间: {formatRelativeTime(task.updatedAt)}
                                                        {!expandedTasks[task.id] && (
                                                            <span className="ml-2 text-blue-600 hidden md:inline">点击展开</span>
                                                        )}
                                                    </p>
                                                </div>
                                                <div className="flex flex-wrap gap-2 w-full md:w-auto md:ml-auto mt-1 md:mt-0">
                                                    <Button size="sm" className="w-full md:w-auto whitespace-nowrap flex-1 md:flex-none" onClick={async () => {
                                                        try {
                                                            const t = tasks.find(tt => tt.id === task.id)
                                                            if (!t) return
                                                            const md = t.results.find(r => r.step === WorkflowStep.CONTENT_GENERATION)?.content || ''
                                                            const payload = (mapContentToRecord as any)(md, '', { Type: 'workflow' })
                                                            await (saveContentRecord as any)(payload)
                                                            await loadDbRecords() // 刷新数据库记录
                                                            alert('已保存到数据库并可在处理结果页渲染')
                                                        } catch (e: any) {
                                                            alert(`保存失败：${e?.message || e}`)
                                                        }
                                                    }}>
                                                        保存到数据库
                                                    </Button>
                                                    <Button size="sm" className="w-full md:w-auto whitespace-nowrap flex-1 md:flex-none" onClick={() => handleUploadToLark(task.id)}>
                                                        <UploadCloud className="h-4 w-4 mr-1" />
                                                        {renderProgressLabel(`lark-${task.id}`, '上传到多维')}
                                                    </Button>
                                                    <Button size="sm" variant="outline" onClick={() => handleUploadImages(task.id, 'Cover')} className="w-full md:w-auto whitespace-nowrap flex-1 md:flex-none">
                                                        {renderProgressLabel(`cover-${task.id}`, '上传封面到图床')}
                                                    </Button>
                                                    <Button size="sm" variant="outline" onClick={() => handleUploadImages(task.id, 'Example_Output')} className="w-full md:w-auto whitespace-nowrap flex-1 md:flex-none">
                                                        {renderProgressLabel(`example-${task.id}`, '上传示例到图床')}
                                                    </Button>
                                                </div>
                                            </div>
                                        </CardHeader>
                                        {!expandedTasks[task.id] && (
                                            <div className="px-6 pb-4 -mt-2">
                                                {(() => {
                                                    // 折叠预览：仅展示中文标题与中文描述
                                                    const cnTitle = (parsedRecord?.Title_CN || parsedRecord?.Title || '').toString().trim()
                                                    const cnDescSource = (parsedRecord?.Description_CN || parsedRecord?.Description || contentMd || '').toString().trim()
                                                    const cnDesc = cnDescSource.length > 88 ? cnDescSource.slice(0, 88) + '...' : cnDescSource
                                                    return (
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-sm font-medium truncate" title={cnTitle || undefined}>{cnTitle || '未命名'}</div>
                                                                <div className="text-xs text-muted-foreground line-clamp-2" title={cnDescSource || undefined}>{cnDesc || '暂无描述'}</div>
                                                            </div>
                                                            <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" onClick={() => toggleTaskExpanded(task.id)}>
                                                                展开
                                                            </Button>
                                                        </div>
                                                    )
                                                })()}
                                            </div>
                                        )}
                                        {expandedTasks[task.id] && (
                                            <CardContent>
                                                <div className="flex justify-end mb-2">
                                                    <Button size="sm" variant="ghost" onClick={() => toggleTaskExpanded(task.id)} className="whitespace-nowrap">收起</Button>
                                                </div>
                                                {/* 拖拽上传示例图片到图床（叠加背景） */}
                                                <ImageDropzone
                                                    field="Example_Output"
                                                    onUpload={(files) => processUploadImages(task.id, 'Example_Output', files)}
                                                />
                                                {parsedRecord && (
                                                    <div className="mb-4 p-3 rounded border bg-gray-50">
                                                        <div className="font-semibold mb-2">结构化信息</div>
                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                                                            <div className="truncate" title={parsedRecord.Title}><span className="text-gray-500">Title：</span>{parsedRecord.Title}</div>
                                                            <div className="truncate" title={parsedRecord.Type}><span className="text-gray-500">Type：</span>{parsedRecord.Type}</div>
                                                            <div className="truncate" title={parsedRecord.like}><span className="text-gray-500">Like：</span>{parsedRecord.like}</div>
                                                            <div className="md:col-span-3 text-muted-foreground">
                                                                <span className="text-gray-500">Description：</span>
                                                                <span className="line-clamp-2">{parsedRecord.Description}</span>
                                                            </div>
                                                            {parsedRecord.Usage_Guide && (
                                                                <div className="md:col-span-3 text-muted-foreground">
                                                                    <span className="text-gray-500">Usage_Guide：</span>
                                                                    <span className="line-clamp-2">{parsedRecord.Usage_Guide}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                                <Tabs defaultValue="all" className="w-full">
                                                    <TabsList className="grid w-full grid-cols-3">
                                                        <TabsTrigger value="all">全部</TabsTrigger>
                                                        <TabsTrigger value="content">创意</TabsTrigger>
                                                        <TabsTrigger value="image">图片</TabsTrigger>
                                                    </TabsList>

                                                    <TabsContent value="all" className="space-y-3 mt-4">
                                                        {task.results.map(result => (
                                                            <div
                                                                key={result.id}
                                                                className="border rounded-lg p-4 space-y-3"
                                                            >
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-2">
                                                                        {getStepIcon(result.step)}
                                                                        <span className={cn(
                                                                            "px-2 py-1 rounded-full text-xs font-medium",
                                                                            getStepColor(result.step)
                                                                        )}>
                                                                            {getStepName(result.step)}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-1">
                                                                        <Button
                                                                            size="sm"
                                                                            variant="ghost"
                                                                            onClick={() => {
                                                                                setSelectedResult(result)
                                                                                setPreviewOpen(true)
                                                                            }}
                                                                            title="预览内容"
                                                                        >
                                                                            <Eye className="h-4 w-4" />
                                                                        </Button>
                                                                        <Button
                                                                            size="sm"
                                                                            variant="ghost"
                                                                            onClick={(e) => copyToClipboard(result.content, e)}
                                                                            title="复制内容"
                                                                        >
                                                                            <Copy className="h-4 w-4" />
                                                                        </Button>
                                                                        <Button
                                                                            size="sm"
                                                                            variant="ghost"
                                                                            onClick={() => {
                                                                                const baseFilename = file.name.replace(/\.[^/.]+$/, '')
                                                                                let filename = ''

                                                                                switch (result.step) {
                                                                                    case WorkflowStep.CONTENT_GENERATION:
                                                                                        filename = `${baseFilename}_content_strategy.md`
                                                                                        handleDownloadResult(result.content, filename, false)
                                                                                        return
                                                                                    case WorkflowStep.IMAGE_GENERATION:
                                                                                        downloadImagePair(result, baseFilename)
                                                                                        return
                                                                                    case WorkflowStep.DOCUMENT_GENERATION:
                                                                                        filename = `${baseFilename}_documentation.md`
                                                                                        handleDownloadResult(result.content, filename, false)
                                                                                        return
                                                                                    default:
                                                                                        filename = `${baseFilename}_result.txt`
                                                                                        handleDownloadResult(result.content, filename, false)
                                                                                        return
                                                                                }
                                                                            }}
                                                                        >
                                                                            <Download className="h-4 w-4" />
                                                                        </Button>
                                                                    </div>
                                                                </div>

                                                                {/* 内容预览 */}
                                                                <div className="space-y-2">
                                                                    {result.step === WorkflowStep.IMAGE_GENERATION ? (
                                                                        <div className="p-4 bg-gray-50 rounded">
                                                                            {((result.metadata as any)?.images?.length) ? (
                                                                                <div className="grid grid-cols-2 gap-3">
                                                                                    {(result.metadata as any).images.map((img: any) => (
                                                                                        <div key={img.url} className="flex items-center justify-center bg-white rounded border">
                                                                                            <img src={img.url} alt={img.kind} className="max-w-full max-h-32 object-contain rounded" />
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            ) : (
                                                                                <div className="flex items-center justify-center bg-white rounded border">
                                                                                    <img src={result.content} alt="生成的图片" className="max-w-full max-h-32 object-contain rounded" />
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="bg-gray-50 rounded p-3 text-sm">
                                                                            <div className="line-clamp-3 text-muted-foreground">
                                                                                {result.content.length > 200
                                                                                    ? result.content.substring(0, 200) + '...'
                                                                                    : result.content
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* 元数据 */}
                                                                    {result.metadata && (
                                                                        <div className="text-xs text-muted-foreground">
                                                                            {result.step === WorkflowStep.IMAGE_GENERATION && (
                                                                                <div>
                                                                                    提示词: {result.metadata.prompt?.substring(0, 100)}...
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </TabsContent>

                                                    {/* 分类标签页内容 */}
                                                    {['content', 'image'].map(stepType => (
                                                        <TabsContent key={stepType} value={stepType} className="space-y-3 mt-4">
                                                            {task.results
                                                                .filter(result => {
                                                                    switch (stepType) {
                                                                        case 'content':
                                                                            return result.step === WorkflowStep.CONTENT_GENERATION
                                                                        case 'image':
                                                                            return result.step === WorkflowStep.IMAGE_GENERATION
                                                                        default:
                                                                            return false
                                                                    }
                                                                })
                                                                .map(result => (
                                                                    <div
                                                                        key={result.id}
                                                                        className="border rounded-lg p-4 space-y-3"
                                                                    >
                                                                        {result.step === WorkflowStep.IMAGE_GENERATION ? (
                                                                            <div className="space-y-3">
                                                                                {((result.metadata as any)?.images?.length) ? (
                                                                                    <div className="grid grid-cols-2 gap-4">
                                                                                        {(result.metadata as any).images.map((img: any) => (
                                                                                            <div key={img.url} className="space-y-2">
                                                                                                <img src={img.url} alt={img.kind} className="w-full rounded-lg" />
                                                                                                <div className="flex justify-between items-center text-xs text-muted-foreground">
                                                                                                    <span>{img.kind === 'youtube' ? 'YouTube' : img.kind === 'instagram' ? 'Instagram' : 'Image'}</span>
                                                                                                    <span>{img.size || '1024x1024'}</span>
                                                                                                </div>
                                                                                                <div className="flex gap-2">
                                                                                                    <Button size="sm" variant="outline" onClick={() => window.open(img.url, '_blank')}>
                                                                                                        <ExternalLink className="h-4 w-4 mr-1" />
                                                                                                        查看原图
                                                                                                    </Button>
                                                                                                    <Button size="sm" onClick={() => downloadImage(img.url, `${file.name.replace(/\.[^/.]+$/, '')}_${img.kind}.png`)}>
                                                                                                        <Download className="h-4 w-4 mr-1" />
                                                                                                        下载
                                                                                                    </Button>
                                                                                                </div>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                ) : (
                                                                                    <>
                                                                                        <img src={result.content} alt="生成的图片" className="w-full rounded-lg" />
                                                                                        <div className="flex justify-between items-center">
                                                                                            <span className="text-sm text-muted-foreground">尺寸: {result.metadata?.size || '1024x1024'}</span>
                                                                                            <div className="flex gap-2">
                                                                                                <Button size="sm" variant="outline" onClick={() => window.open(result.content, '_blank')}>
                                                                                                    <ExternalLink className="h-4 w-4 mr-1" />
                                                                                                    查看原图
                                                                                                </Button>
                                                                                                <Button size="sm" onClick={() => downloadImage(result.content, `${file.name.replace(/\.[^/.]+$/, '')}_cover.png`)}>
                                                                                                    <Download className="h-4 w-4 mr-1" />
                                                                                                    下载
                                                                                                </Button>
                                                                                            </div>
                                                                                        </div>
                                                                                    </>
                                                                                )}
                                                                            </div>
                                                                        ) : (
                                                                            <div className="space-y-3">
                                                                                <div className="bg-gray-50 rounded p-4 text-sm font-mono">
                                                                                    <pre className="whitespace-pre-wrap">
                                                                                        {result.content}
                                                                                    </pre>
                                                                                </div>
                                                                                <div className="flex justify-between items-center">
                                                                                    <span className="text-sm text-muted-foreground">
                                                                                        {formatFileSize(new Blob([result.content]).size)}
                                                                                    </span>
                                                                                    <div className="flex gap-2">
                                                                                        <Button
                                                                                            size="sm"
                                                                                            variant="outline"
                                                                                            onClick={(e) => copyToClipboard(result.content, e)}
                                                                                        >
                                                                                            <Copy className="h-4 w-4 mr-1" />
                                                                                            复制
                                                                                        </Button>
                                                                                        <Button
                                                                                            size="sm"
                                                                                            onClick={() => {
                                                                                                const filename = stepType === 'content'
                                                                                                    ? `${file.name.replace(/\.[^/.]+$/, '')}_content.md`
                                                                                                    : `${file.name.replace(/\.[^/.]+$/, '')}_document.md`
                                                                                                downloadFile(result.content, filename)
                                                                                            }}
                                                                                        >
                                                                                            <Download className="h-4 w-4 mr-1" />
                                                                                            下载
                                                                                        </Button>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))
                                                            }
                                                            {task.results.filter(result => {
                                                                switch (stepType) {
                                                                    case 'content':
                                                                        return result.step === WorkflowStep.CONTENT_GENERATION
                                                                    case 'image':
                                                                        return result.step === WorkflowStep.IMAGE_GENERATION
                                                                    default:
                                                                        return false
                                                                }
                                                            }).length === 0 && (
                                                                    <div className="text-center py-8 text-muted-foreground">
                                                                        暂无此类型的结果
                                                                    </div>
                                                                )}
                                                        </TabsContent>
                                                    ))}
                                                </Tabs>
                                            </CardContent>
                                        )}
                                    </Card>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <h2 className="text-lg font-semibold text-gray-900">最近保存的记录</h2>
                            {dbRecords.length === 0 ? (
                                <div className="text-sm text-muted-foreground">暂无数据。请先运行工作流程并点击“保存到数据库”，或等待自动保存完成。</div>
                            ) : (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {dbRecords.map((rec: any) => {
                                        const cover = String(rec.cover || rec.Cover || '').split(',').map((s: string) => s.trim()).filter(Boolean)[0]
                                        const examples = String(rec.example_output || rec.Example_Output || '').split(',').map((s: string) => s.trim()).filter(Boolean)
                                        return (
                                            <Card key={rec.id || rec.Title} className="card-hover">
                                                <CardHeader>
                                                    <div className="flex items-center gap-3">
                                                        <div className="text-2xl">📄</div>
                                                        <div className="flex-1 min-w-0">
                                                            <CardTitle className="text-lg truncate">{rec.Title || rec.title || 'Untitled'}</CardTitle>
                                                            <p className="text-sm text-muted-foreground">
                                                                更新时间: {rec.updated_at ? formatRelativeTime(new Date(rec.updated_at)) : (rec.created_at ? formatRelativeTime(new Date(rec.created_at)) : '未知')}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </CardHeader>
                                                <CardContent>
                                                    <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        <div>
                                                            <div className="text-sm font-medium mb-1">封面</div>
                                                            <div className="flex items-center justify-center bg-white rounded border min-h-24">
                                                                {cover ? (
                                                                    <img src={cover} alt="cover" className="max-w-full max-h-32 object-contain rounded" />
                                                                ) : (
                                                                    <span className="text-xs text-muted-foreground">无</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-medium mb-1">示例</div>
                                                            {examples.length > 0 ? (
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    {examples.slice(0, 4).map((u: string, i: number) => (
                                                                        <div key={u + i} className="flex items-center justify-center bg-white rounded border">
                                                                            <img src={u} alt={`example_${i + 1}`} className="max-w-full max-h-24 object-contain rounded" />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center justify-center bg-white rounded border min-h-24">
                                                                    <span className="text-xs text-muted-foreground">无</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="text-sm text-gray-700">
                                                        <div className="mb-1"><span className="text-gray-500">Type：</span>{rec.Type || rec.type || 'workflow'}</div>
                                                        <div className="mb-1"><span className="text-gray-500">Category：</span>{rec.Category || rec.category || '-'}</div>
                                                        <div className="mb-1"><span className="text-gray-500">Like：</span>{rec.like ?? 0}</div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="database" className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold text-gray-900">数据库记录</h2>
                        <Button onClick={loadDbRecords} variant="outline" size="sm" disabled={loadingRecords}>
                            <Database className="h-4 w-4 mr-2" />
                            {loadingRecords ? '加载中...' : '刷新'}
                        </Button>
                    </div>

                    {dbRecords.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-12">
                                <div className="text-6xl mb-4">💾</div>
                                <h3 className="text-lg font-medium mb-2">暂无数据库记录</h3>
                                <p className="text-muted-foreground text-center">
                                    保存工作流结果到数据库后，<br />
                                    记录将会显示在这里
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {dbRecords.map((record: any) => (
                                <Card key={record.id} className="card-hover">
                                    <CardHeader>
                                        <div className="flex items-center gap-3">
                                            <div className="text-2xl">💾</div>
                                            <div className="flex-1 min-w-0">
                                                <CardTitle className="text-lg truncate">{record.Title}</CardTitle>
                                                <p className="text-sm text-muted-foreground">
                                                    保存时间: {record.created_at ? formatRelativeTime(new Date(record.created_at)) : '未知'}
                                                </p>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                                <div><span className="text-gray-500">描述：</span>{record.Description}</div>
                                                <div><span className="text-gray-500">分类：</span>{record.Category || '未分类'}</div>
                                                <div><span className="text-gray-500">类型：</span>{record.Type}</div>
                                                <div><span className="text-gray-500">点赞：</span>{record.like}</div>
                                                <div><span className="text-gray-500">状态：</span>{record.status}</div>
                                                <div className="md:col-span-2"><span className="text-gray-500">使用指南：</span>{record.Usage_Guide?.slice(0, 160) || ''}...</div>
                                                {record.Title_CN && <div className="md:col-span-2"><span className="text-gray-500">中文标题：</span>{record.Title_CN}</div>}
                                                {record.Description_CN && <div className="md:col-span-2"><span className="text-gray-500">中文描述：</span>{record.Description_CN}</div>}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
            {/* 预览Dialog */}
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>
                            {selectedResult && (
                                <div className="flex items-center">
                                    {getStepIcon(selectedResult.step)}
                                    <span className="ml-2">{getStepName(selectedResult.step)} - {'预览'}</span>
                                </div>
                            )}
                        </DialogTitle>
                    </DialogHeader>

                    {selectedResult && (
                        <div className="overflow-auto max-h-[60vh]">
                            {selectedResult.step === WorkflowStep.IMAGE_GENERATION ? (
                                <div className="text-center">
                                    <img
                                        src={selectedResult.content}
                                        alt="生成的图片"
                                        className="max-w-full max-h-[50vh] object-contain mx-auto rounded-lg"
                                    />
                                    {selectedResult.metadata?.prompt && (
                                        <div className="mt-4 p-3 bg-gray-50 rounded-lg text-left">
                                            <div className="text-sm font-medium mb-2">{'图像提示词：'}</div>
                                            <div className="text-sm text-gray-600">{selectedResult.metadata.prompt}</div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-lg border">
                                        {selectedResult.content}
                                    </pre>
                                    <div className="flex gap-2">
                                        <Button onClick={(e) => copyToClipboard(selectedResult.content, e)} variant="outline">
                                            <Copy className="h-4 w-4 mr-2" />
                                            {'复制内容'}
                                        </Button>
                                        <Button
                                            onClick={() => {
                                                let filename = ''
                                                switch (selectedResult.step) {
                                                    case WorkflowStep.CONTENT_GENERATION:
                                                        filename = 'content_strategy.md'
                                                        break
                                                    case WorkflowStep.DOCUMENT_GENERATION:
                                                        filename = 'documentation.md'
                                                        break
                                                    default:
                                                        filename = 'result.txt'
                                                }
                                                downloadFile(selectedResult.content, filename)
                                            }}
                                            variant="outline"
                                        >
                                            <Download className="h-4 w-4 mr-2" />
                                            {'下载文件'}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}

// 组件：拖拽上传图片到图床（示例图片，自动叠加背景）
// 使用说明：将图片拖到区域内即可，处理完成后自动写入数据库 Example_Output 字段。
const ImageDropzone: React.FC<{ field: 'Cover' | 'Example_Output'; onUpload?: (files: File[]) => void }> = ({ field, onUpload }) => {
    const { config } = useAppStore()
    const [isUploading, setIsUploading] = useState(false)
    // 本组件仅负责触发上传；复用 ResultsPanel 的统一上传逻辑需通过自定义事件转发

    const onDrop = async (acceptedFiles: File[]) => {
        if (!acceptedFiles || acceptedFiles.length === 0) return
        setIsUploading(true)
        try {
            if (onUpload) {
                onUpload(acceptedFiles)
            }
        } finally {
            setIsUploading(false)
        }
    }

    const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
        onDrop,
        accept: { 'image/*': [] },
        multiple: true,
        maxSize: config.maxFileSize
    })

    return (
        <div
            {...getRootProps()}
            className={cn(
                "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all duration-200 mb-4 overflow-hidden",
                isDragActive && !isDragReject && "dropzone-active",
                isDragReject && "dropzone-reject",
                !isDragActive && "border-gray-200 hover:border-primary"
            )}
            title={field === 'Example_Output' ? '拖拽图片到此，自动叠加背景后上传到图床' : '拖拽图片到此上传为封面'}
        >
            <input {...getInputProps()} />
            <div className="text-sm text-muted-foreground">
                {isUploading ? '正在上传...' : (isDragActive ? (isDragReject ? '不支持的文件格式' : '释放鼠标开始上传') : '拖拽图片到此处（也可点击选择）')}
            </div>
        </div>
    )
}


