import React, { useEffect } from 'react'
import { Play, Pause, RotateCcw, Download, CheckCircle, Clock, AlertCircle, Loader2, Eye } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useAppStore } from '@/stores/appStore'
import { getWorkflowService } from '@/services/workflowService'
import { FileStatus, WorkflowStep, WorkflowStepStatus } from '@/types'
import { cn } from '@/lib/utils'

export const WorkflowPanel: React.FC = () => {
    const {
        files,
        selectedFiles,
        tasks,
        isProcessing,
        stats,
        updateStats
    } = useAppStore()

    const workflowService = getWorkflowService()

    // 更新统计信息
    useEffect(() => {
        updateStats()
    }, [files, tasks, updateStats])

    const selectedFileItems = files.filter(f => selectedFiles.includes(f.id))

    const handleStartWorkflow = async () => {
        if (selectedFiles.length === 0) {
            alert('请先选择要处理的文件')
            return
        }

        await workflowService.startParallelWorkflow(selectedFiles)
    }

    const handleStopWorkflow = () => {
        workflowService.cancelAllTasks()
    }

    const handleRetryTask = async (taskId: string) => {
        await workflowService.retryTask(taskId)
    }

    const getStepIcon = (status: WorkflowStepStatus) => {
        switch (status) {
            case WorkflowStepStatus.PENDING:
                return <Clock className="h-4 w-4 text-gray-400" />
            case WorkflowStepStatus.ACTIVE:
            case WorkflowStepStatus.PROCESSING:
                return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
            case WorkflowStepStatus.COMPLETED:
                return <CheckCircle className="h-4 w-4 text-green-500" />
            case WorkflowStepStatus.ERROR:
                return <AlertCircle className="h-4 w-4 text-red-500" />
            default:
                return <Clock className="h-4 w-4 text-gray-400" />
        }
    }

    const getStepName = (step: WorkflowStep) => {
        switch (step) {
            case WorkflowStep.CONTENT_GENERATION:
                return '生成内容创意'
            case WorkflowStep.IMAGE_GENERATION:
                return '生成封面图片'
            case WorkflowStep.DOCUMENT_GENERATION:
                return '生成MD文档'
            default:
                return '未知步骤'
        }
    }

    const getStepDescription = (step: WorkflowStep) => {
        switch (step) {
            case WorkflowStep.CONTENT_GENERATION:
                return '分析文件内容，生成爆款标题、描述和封面图提示词'
            case WorkflowStep.IMAGE_GENERATION:
                return '基于提示词使用AI生成高质量封面图片'
            case WorkflowStep.DOCUMENT_GENERATION:
                return '生成结构化的技术文档和说明'
            default:
                return ''
        }
    }

    return (
        <div className="space-y-6">
            {/* 工作流控制面板 */}
            <Card className="card-hover">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                            🚀 AI内容创作工作流
                        </CardTitle>
                        <div className="flex items-center gap-2">
                            {!isProcessing ? (
                                <Button
                                    onClick={handleStartWorkflow}
                                    disabled={selectedFiles.length === 0}
                                    className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90"
                                >
                                    <Play className="h-4 w-4 mr-2" />
                                    开始处理 ({selectedFiles.length})
                                </Button>
                            ) : (
                                <Button onClick={handleStopWorkflow} variant="destructive">
                                    <Pause className="h-4 w-4 mr-2" />
                                    停止处理
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground mb-4">
                        通过两步完成内容创作：生成AI结果与单张封面图，每个文件都有独立的处理流水线
                    </p>

                    {/* 工作流步骤指示器 */}
                    <div className="flex items-center justify-between mb-6 relative">
                        <div className="absolute top-4 left-4 right-4 h-0.5 bg-gray-200"></div>
                        {[WorkflowStep.CONTENT_GENERATION, WorkflowStep.IMAGE_GENERATION].map((step, index) => (
                            <div key={step} className="flex flex-col items-center relative z-10">
                                <div className="w-8 h-8 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center mb-2">
                                    <span className="text-sm font-medium">{index + 1}</span>
                                </div>
                                <div className="text-xs text-center max-w-20">
                                    {getStepName(step)}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 统计信息 */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center p-3 rounded-lg bg-blue-50">
                            <div className="text-2xl font-bold text-blue-600">{stats.totalFiles}</div>
                            <div className="text-sm text-blue-600">总文件数</div>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-green-50">
                            <div className="text-2xl font-bold text-green-600">{stats.completedTasks}</div>
                            <div className="text-sm text-green-600">已完成</div>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-red-50">
                            <div className="text-2xl font-bold text-red-600">{stats.errorTasks}</div>
                            <div className="text-sm text-red-600">失败任务</div>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-purple-50">
                            <div className="text-2xl font-bold text-purple-600">
                                {Math.round(stats.totalProgress)}%
                            </div>
                            <div className="text-sm text-purple-600">总进度</div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* 文件任务列表 */}
            {selectedFileItems.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>文件处理状态</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {selectedFileItems.map((file) => {
                                const task = tasks.find(t => t.fileId === file.id)

                                return (
                                    <div
                                        key={file.id}
                                        className="border rounded-lg p-4 space-y-4"
                                    >
                                        {/* 文件头部信息 */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="text-xl">📄</div>
                                                <div>
                                                    <h3 className="font-medium">{file.name}</h3>
                                                    <p className="text-sm text-muted-foreground">
                                                        状态: {file.status === FileStatus.PENDING && '待处理'}
                                                        {file.status === FileStatus.PROCESSING && '处理中'}
                                                        {file.status === FileStatus.COMPLETED && '已完成'}
                                                        {file.status === FileStatus.ERROR && '错误'}
                                                        {file.status === FileStatus.CANCELLED && '已取消'}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* 操作按钮 */}
                                            <div className="flex items-center gap-2">
                                                {file.status === FileStatus.ERROR && task && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleRetryTask(task.id)}
                                                    >
                                                        <RotateCcw className="h-4 w-4 mr-1" />
                                                        重试
                                                    </Button>
                                                )}
                                                {file.status === FileStatus.COMPLETED && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="text-green-600"
                                                        onClick={() => {
                                                            // 下载该文件的所有结果
                                                            if (task && task.results.length > 0) {
                                                                const baseFilename = file.name.replace(/\.[^/.]+$/, '')

                                                                task.results.forEach(result => {
                                                                    let filename = ''
                                                                    let isImage = false

                                                                    switch (result.step) {
                                                                        case WorkflowStep.CONTENT_GENERATION:
                                                                            filename = `${baseFilename}_content_strategy.md`
                                                                            break
                                                                        case WorkflowStep.IMAGE_GENERATION:
                                                                            filename = `${baseFilename}_cover_image.png`
                                                                            isImage = true
                                                                            break
                                                                        case WorkflowStep.DOCUMENT_GENERATION:
                                                                            filename = `${baseFilename}_documentation.md`
                                                                            break
                                                                        default:
                                                                            filename = `${baseFilename}_result.txt`
                                                                    }

                                                                    // 延迟下载以避免浏览器阻止多个下载
                                                                    setTimeout(() => {
                                                                        if (isImage) {
                                                                            const link = document.createElement('a')
                                                                            link.href = result.content
                                                                            link.download = filename
                                                                            link.click()
                                                                        } else {
                                                                            const blob = new Blob([result.content], { type: 'text/markdown;charset=utf-8' })
                                                                            const url = URL.createObjectURL(blob)
                                                                            const link = document.createElement('a')
                                                                            link.href = url
                                                                            link.download = filename
                                                                            link.click()
                                                                            URL.revokeObjectURL(url)
                                                                        }
                                                                    }, task.results.indexOf(result) * 500) // 延迟500ms
                                                                })
                                                            }
                                                        }}
                                                    >
                                                        <Download className="h-4 w-4 mr-1" />
                                                        下载结果
                                                    </Button>
                                                )}
                                            </div>
                                        </div>

                                        {/* 总进度条 */}
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-sm">
                                                <span>总进度</span>
                                                <span>{file.progress}%</span>
                                            </div>
                                            <Progress
                                                value={file.progress}
                                                className="h-2"
                                                animated={file.status === FileStatus.PROCESSING}
                                            />
                                        </div>

                                        {/* 工作流步骤详情 */}
                                        {task && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {task.steps
                                                    .filter(s => s.step !== WorkflowStep.DOCUMENT_GENERATION)
                                                    .map((stepConfig) => {
                                                        // 查找该步骤的结果
                                                        const stepResult = task.results.find(r => r.step === stepConfig.step)

                                                        return (
                                                            <div
                                                                key={stepConfig.step}
                                                                className={cn(
                                                                    "p-3 rounded-lg border",
                                                                    stepConfig.status === WorkflowStepStatus.COMPLETED && "border-green-200 bg-green-50",
                                                                    stepConfig.status === WorkflowStepStatus.PROCESSING && "border-blue-200 bg-blue-50",
                                                                    stepConfig.status === WorkflowStepStatus.ERROR && "border-red-200 bg-red-50",
                                                                    stepConfig.status === WorkflowStepStatus.PENDING && "border-gray-200 bg-gray-50"
                                                                )}
                                                            >
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <div className="flex items-center gap-2">
                                                                        {getStepIcon(stepConfig.status)}
                                                                        <span className="font-medium text-sm">
                                                                            {getStepName(stepConfig.step)}{stepConfig.step === WorkflowStep.DOCUMENT_GENERATION ? '（已合并至步骤一，已隐藏）' : ''}
                                                                        </span>
                                                                    </div>

                                                                    {/* 步骤操作按钮 */}
                                                                    {stepConfig.status === WorkflowStepStatus.COMPLETED && stepResult && (
                                                                        <div className="flex items-center gap-1">
                                                                            <Button
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                className="h-6 w-6 p-0"
                                                                                onClick={() => {
                                                                                    // 预览步骤结果
                                                                                    if (stepConfig.step === WorkflowStep.IMAGE_GENERATION) {
                                                                                        window.open(stepResult.content, '_blank')
                                                                                    } else {
                                                                                        // 创建预览弹窗
                                                                                        const previewWindow = window.open('', '_blank')
                                                                                        if (previewWindow) {
                                                                                            previewWindow.document.write(`
                                                                            <html>
                                                                                <head>
                                                                                    <title>${getStepName(stepConfig.step)} - 预览</title>
                                                                                    <style>
                                                                                        body { 
                                                                                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                                                                                            padding: 20px; 
                                                                                            line-height: 1.6; 
                                                                                            max-width: 800px; 
                                                                                            margin: 0 auto; 
                                                                                        }
                                                                                        pre { 
                                                                                            background: #f5f5f5; 
                                                                                            padding: 15px; 
                                                                                            border-radius: 8px; 
                                                                                            overflow-x: auto; 
                                                                                            white-space: pre-wrap; 
                                                                                        }
                                                                                    </style>
                                                                                </head>
                                                                                <body>
                                                                                    <h1>${getStepName(stepConfig.step)}</h1>
                                                                                    <pre>${stepResult.content}</pre>
                                                                                </body>
                                                                            </html>
                                                                        `)
                                                                                            previewWindow.document.close()
                                                                                        }
                                                                                    }
                                                                                }}
                                                                                title="预览结果"
                                                                            >
                                                                                <Eye className="h-3 w-3" />
                                                                            </Button>
                                                                            <Button
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                className="h-6 w-6 p-0"
                                                                                onClick={() => {
                                                                                    // 下载步骤结果
                                                                                    const baseFilename = file.name.replace(/\.[^/.]+$/, '')
                                                                                    if (stepConfig.step === WorkflowStep.IMAGE_GENERATION && (stepResult.metadata as any)?.images?.length) {
                                                                                        const images = (stepResult.metadata as any).images as Array<any>
                                                                                        images.forEach((img: any, idx: number) => {
                                                                                            const suffix = img.kind === 'youtube' ? 'youtube_thumb' : img.kind === 'instagram' ? 'instagram_cover' : `image_${idx + 1}`
                                                                                            setTimeout(() => {
                                                                                                const a = document.createElement('a')
                                                                                                a.href = img.url
                                                                                                a.download = `${baseFilename}_${suffix}.png`
                                                                                                a.click()
                                                                                            }, idx * 300)
                                                                                        })
                                                                                        return
                                                                                    }

                                                                                    let filename = ''
                                                                                    switch (stepConfig.step) {
                                                                                        case WorkflowStep.CONTENT_GENERATION:
                                                                                            filename = `${baseFilename}_content_strategy.md`
                                                                                            break
                                                                                        case WorkflowStep.IMAGE_GENERATION:
                                                                                            filename = `${baseFilename}_cover_image.png`
                                                                                            break
                                                                                        case WorkflowStep.DOCUMENT_GENERATION:
                                                                                            filename = `${baseFilename}_documentation.md`
                                                                                            break
                                                                                        default:
                                                                                            filename = `${baseFilename}_result.txt`
                                                                                    }
                                                                                    // 下载文本或单张图片
                                                                                    if (stepConfig.step === WorkflowStep.IMAGE_GENERATION) {
                                                                                        const a = document.createElement('a')
                                                                                        a.href = stepResult.content
                                                                                        a.download = filename
                                                                                        a.click()
                                                                                    } else {
                                                                                        const blob = new Blob([stepResult.content], { type: 'text/markdown;charset=utf-8' })
                                                                                        const url = URL.createObjectURL(blob)
                                                                                        const a = document.createElement('a')
                                                                                        a.href = url
                                                                                        a.download = filename
                                                                                        a.click()
                                                                                        URL.revokeObjectURL(url)
                                                                                    }
                                                                                }}
                                                                                title="下载结果"
                                                                            >
                                                                                <Download className="h-3 w-3" />
                                                                            </Button>
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                <p className="text-xs text-muted-foreground mb-2">
                                                                    {getStepDescription(stepConfig.step)}
                                                                </p>

                                                                {/* 步骤进度 */}
                                                                {stepConfig.status === WorkflowStepStatus.PROCESSING && (
                                                                    <div className="space-y-1">
                                                                        <Progress value={stepConfig.progress} className="h-1" animated />
                                                                        <div className="text-xs text-muted-foreground">
                                                                            {stepConfig.progress}%
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* 步骤结果预览 */}
                                                                {stepConfig.status === WorkflowStepStatus.COMPLETED && stepResult && (
                                                                    <div className="mt-2 p-2 bg-white rounded border">
                                                                        {stepConfig.step === WorkflowStep.IMAGE_GENERATION ? (
                                                                            ((stepResult.metadata as any)?.images?.length) ? (
                                                                                <div className="grid grid-cols-2 gap-2">
                                                                                    {(stepResult.metadata as any).images.map((img: any) => (
                                                                                        <img key={img.url} src={img.url} alt={img.kind} className="max-w-full max-h-20 object-contain mx-auto rounded" />
                                                                                    ))}
                                                                                </div>
                                                                            ) : (
                                                                                <div className="text-center">
                                                                                    <img
                                                                                        src={stepResult.content}
                                                                                        alt="生成的图片"
                                                                                        className="max-w-full max-h-20 object-contain mx-auto rounded"
                                                                                    />
                                                                                </div>
                                                                            )
                                                                        ) : (
                                                                            <div className="text-xs text-gray-600 line-clamp-2">
                                                                                {stepResult.content.length > 100
                                                                                    ? stepResult.content.substring(0, 100) + '...'
                                                                                    : stepResult.content
                                                                                }
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* 错误信息 */}
                                                                {stepConfig.status === WorkflowStepStatus.ERROR && stepConfig.error && (
                                                                    <div className="text-xs text-red-600 mt-1">
                                                                        {stepConfig.error}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                            </div>
                                        )}

                                        {/* 错误信息 */}
                                        {file.error && (
                                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                                <div className="flex items-center gap-2 text-red-600">
                                                    <AlertCircle className="h-4 w-4" />
                                                    <span className="text-sm font-medium">处理失败</span>
                                                </div>
                                                <p className="text-sm text-red-600 mt-1">{file.error}</p>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
