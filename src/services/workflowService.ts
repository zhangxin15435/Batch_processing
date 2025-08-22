import {
    WorkflowTask,
    WorkflowStep,
    WorkflowStepStatus,
    FileStatus,
    APIConfig
} from '@/types'
import { APIService } from './apiService'
import { mapContentToRecord } from '@/lib/contentMapper'
import { saveContentRecord } from '@/services/contentService'
import { MOLYHUB_PROMPT, getRandomMolyhubPrompt } from '@/prompts/molyhub'
import { TUTORIAL_TO_PROMPT } from '@/prompts/tutorialToPrompt'
import { useAppStore } from '@/stores/appStore'

export class WorkflowService {
    private apiService: APIService
    private activeTasks = new Map<string, AbortController>()

    constructor(apiConfig: APIConfig) {
        this.apiService = new APIService(apiConfig)
    }

    updateConfig(apiConfig: APIConfig) {
        this.apiService.updateConfig(apiConfig)
    }

    /**
     * 启动并行工作流处理
     */
    async startParallelWorkflow(fileIds: string[]): Promise<void> {
        const { setProcessing, updateFileStatus, createWorkflowTask } = useAppStore.getState()

        // 开始处理状态
        setProcessing(true)

        try {
            // 为每个文件创建工作流任务
            const taskIds = fileIds.map(fileId => {
                updateFileStatus(fileId, FileStatus.PROCESSING, 0)
                return createWorkflowTask(fileId)
            })

            // 无并发上限：全部任务同时执行
            const promises = taskIds.map(taskId => this.executeWorkflowTask(taskId))
            await Promise.allSettled(promises)
        } catch (error) {
            console.error('并行工作流执行失败:', error)
        } finally {
            setProcessing(false)
        }
    }

    /**
     * 执行单个工作流任务
     */
    private async executeWorkflowTask(taskId: string): Promise<void> {
        const { tasks, files } = useAppStore.getState()
        const task = tasks.find(t => t.id === taskId)
        if (!task) return

        const file = files.find(f => f.id === task.fileId)
        if (!file) return

        const abortController = new AbortController()
        this.activeTasks.set(taskId, abortController)

        try {
            // 读取内容：支持文件/文本/URL
            let content = await this.apiService.readItemContent({
                sourceType: file.sourceType as any,
                file: file.file,
                rawContent: file.rawContent,
                url: file.url
            })

            // 如果是URL类型，使用tutorial-to-prompt模板先转换内容
            if (file.sourceType === 'url') {
                try {
                    const convertedContent = await this.apiService.generateText(content, TUTORIAL_TO_PROMPT)
                    content = convertedContent
                } catch (error) {
                    console.warn('Tutorial转换失败，使用原始内容:', error)
                    // 转换失败时继续使用原始内容，不中断工作流
                }
            }

            // 按步骤执行工作流
            for (let stepIndex = 0; stepIndex < task.steps.length; stepIndex++) {
                if (abortController.signal.aborted) {
                    throw new Error('任务已取消')
                }

                await this.executeWorkflowStep(taskId, stepIndex, content)
            }

            // 注释：数据已在executeWorkflowStep的CONTENT_GENERATION步骤中保存，无需重复保存

            // 任务完成：标记任务与文件为完成
            const storeNow = useAppStore.getState()
            storeNow.updateFileStatus(task.fileId, FileStatus.COMPLETED, 100)
            if ((storeNow as any).setTaskStatus) {
                ; (storeNow as any).setTaskStatus(taskId, FileStatus.COMPLETED)
            }

        } catch (error) {
            console.error(`工作流任务 ${taskId} 执行失败:`, error)
            useAppStore.getState().updateFileStatus(
                task.fileId,
                FileStatus.ERROR,
                undefined,
                error instanceof Error ? error.message : '未知错误'
            )
        } finally {
            this.activeTasks.delete(taskId)
        }
    }

    /**
     * 执行工作流步骤
     */
    private async executeWorkflowStep(
        taskId: string,
        stepIndex: number,
        originalContent: string
    ): Promise<void> {
        const { tasks, updateTaskStep, addTaskResult } = useAppStore.getState()
        const task = tasks.find(t => t.id === taskId)
        if (!task) return

        const step = task.steps[stepIndex]
        if (!step) return

        // 更新步骤状态为处理中
        updateTaskStep(taskId, stepIndex, WorkflowStepStatus.PROCESSING, 0)

        try {
            let result: string = ''
            let metadata: Record<string, any> = {}

            switch (step.step) {
                case WorkflowStep.CONTENT_GENERATION:
                    result = await this.executeContentGeneration(originalContent, step.templateId)
                    // 内容生成完成后：立即解析并写入数据库（以任务ID为键，确保一条记录）
                    try {
                        const recordPayload: any = mapContentToRecord(result, { Type: 'workflow' })
                        const stableRecordId = `rec_${task.fileId}`
                            ; (recordPayload as any).Record_ID = stableRecordId
                        await saveContentRecord(recordPayload)
                    } catch (e) {
                        console.warn('auto-save content(step) failed:', e)
                    }
                    break

                case WorkflowStep.IMAGE_GENERATION:
                    const imageResult = await this.executeImageGeneration(task)
                    result = imageResult.content
                    metadata = imageResult.metadata
                    break

                case WorkflowStep.DOCUMENT_GENERATION:
                    result = await this.executeDocumentGeneration(originalContent, step.templateId)
                    break

                default:
                    throw new Error(`未知的工作流步骤: ${step.step}`)
            }

            // 保存步骤结果
            addTaskResult(taskId, step.step, result, metadata)

            // 更新步骤状态为完成
            updateTaskStep(taskId, stepIndex, WorkflowStepStatus.COMPLETED, 100)

            // 更新文件总进度
            const completedSteps = stepIndex + 1
            const totalSteps = task.steps.length
            const fileProgress = Math.round((completedSteps / totalSteps) * 100)
            useAppStore.getState().updateFileStatus(task.fileId, FileStatus.PROCESSING, fileProgress)

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误'
            updateTaskStep(taskId, stepIndex, WorkflowStepStatus.ERROR, 0, errorMessage)
            throw error
        }
    }

    /**
     * 执行内容生成步骤
     */
    private async executeContentGeneration(content: string, templateId?: string): Promise<string> {
        const { config, updateConfig } = useAppStore.getState()
        let template = config.templates.find(t => t.id === templateId)

        // 若持久化配置里没有新模板，自动补齐
        if (!template && templateId === 'molyhub_prompt_db') {
            const newTemplate = {
                id: 'molyhub_prompt_db',
                name: 'MolyHub Prompt → DB Generator',
                description: 'Generate workflow content + cover prompt; save to DB',
                prompt: MOLYHUB_PROMPT
            }
            updateConfig({ templates: [...config.templates, newTemplate] })
            template = newTemplate
        }

        if (!template) {
            throw new Error(`未找到模板: ${templateId}`)
        }

        // 中文注释：molyhub_prompt_db 模板在运行时随机替换“封面 Prompt”，以避免风格单一
        const runtimePrompt = templateId === 'molyhub_prompt_db'
            ? getRandomMolyhubPrompt()
            : template.prompt

        return await this.apiService.generateText(content, runtimePrompt)
    }

    /**
     * 执行图像生成步骤
     */
    private async executeImageGeneration(task: WorkflowTask): Promise<{
        content: string
        metadata: Record<string, any>
    }> {
        // 获取内容生成步骤的结果
        const contentResult = task.results.find(r => r.step === WorkflowStep.CONTENT_GENERATION)
        if (!contentResult) {
            throw new Error('需要先完成内容生成步骤')
        }

        // 提取图像提示词（优先带类型的）
        const detailedPrompts = this.apiService.extractImagePromptsDetailed(contentResult.content)
        const imagePrompts = detailedPrompts.length > 0 ? detailedPrompts : this.apiService.extractImagePrompts(contentResult.content).map(p => ({ prompt: p, kind: 'other' as const }))
        if (imagePrompts.length === 0) {
            throw new Error('未找到图像提示词')
        }

        // 仅生成一张封面：优先使用“封面 Prompt”或第一个可用提示词
        const coverPrompt = imagePrompts[0].prompt
        const coverImage = await this.apiService.generateImage(coverPrompt)

        // 新增：自动上传到图床并写入数据库
        let uploadedUrl = ''
        try {
            // 调用服务端 TinyPNG 压缩，再上传到图床
            const tinifyResp = await fetch('/api/image/tinypng', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: coverImage.url, mime: 'image/png' })
            })
            const tinifyJson = await tinifyResp.json().catch(() => ({}))
            const compressedDataUrl = tinifyResp.ok && tinifyJson?.success && tinifyJson?.data?.dataUrl
                ? tinifyJson.data.dataUrl
                : coverImage.url
            uploadedUrl = await this.apiService.uploadDataUrlToHosting(
                compressedDataUrl,
                'cover.png',
                'image/png'
            )
        } catch (e) {
            // 上传失败不阻断流程，保留本地 DataURL
            console.warn('auto-upload cover failed:', e)
            uploadedUrl = coverImage.url
        }

        // 只更新封面URL，不覆盖其他已保存的字段
        try {
            // 先读取现有数据，然后只更新Cover字段
            const res = await fetch(`/api/content/one?recordId=${encodeURIComponent(`rec_${task.fileId}`)}`)
            if (res.ok) {
                const data = await res.json()
                if (data.item) {
                    // 保持现有数据，只更新Cover
                    const updatePayload = {
                        Record_ID: `rec_${task.fileId}`,
                        Title: data.item.title,
                        Description: data.item.description,
                        Category: data.item.category,
                        Type: data.item.type,
                        Usage_Guide: data.item.usage_guide,
                        like: data.item.like,
                        status: data.item.status,
                        Title_CN: data.item.title_cn,
                        Description_CN: data.item.description_cn,
                        Usage_Guide_CN: data.item.usage_guide_cn,
                        Slug: data.item.slug,
                        Cover: uploadedUrl // 只更新封面
                    }
                    await saveContentRecord(updatePayload)
                }
            }
        } catch (e) {
            console.warn('auto-save cover failed:', e)
        }

        return {
            content: uploadedUrl,
            metadata: {
                prompt: coverPrompt,
                allPrompts: imagePrompts.map(p => p.prompt),
                images: [
                    { kind: 'cover', url: uploadedUrl, size: coverImage.size, quality: coverImage.quality, b64_json: coverImage.b64_json }
                ]
            }
        }
    }

    /**
     * 执行文档生成步骤
     */
    private async executeDocumentGeneration(content: string, templateId?: string): Promise<string> {
        const { config } = useAppStore.getState()
        const template = config.templates.find(t => t.id === templateId)

        if (!template) {
            throw new Error(`未找到模板: ${templateId}`)
        }

        const rawResult = await this.apiService.generateText(content, template.prompt)
        const parsed = this.apiService.parseMarkdownResponse(rawResult)

        return parsed.content
    }

    /**
     * 取消工作流任务
     */
    cancelTask(taskId: string): void {
        const abortController = this.activeTasks.get(taskId)
        if (abortController) {
            abortController.abort()
            this.activeTasks.delete(taskId)
        }

        // 更新任务状态
        const { updateFileStatus, tasks } = useAppStore.getState()
        const task = tasks.find(t => t.id === taskId)
        if (task) {
            updateFileStatus(task.fileId, FileStatus.CANCELLED)
        }
    }

    /**
     * 取消所有活动任务
     */
    cancelAllTasks(): void {
        this.activeTasks.forEach((controller) => {
            controller.abort()
        })
        this.activeTasks.clear()

        // 更新UI状态
        useAppStore.getState().setProcessing(false)
    }

    /**
     * 重试失败的任务
     */
    async retryTask(taskId: string): Promise<void> {
        const { tasks } = useAppStore.getState()
        const task = tasks.find(t => t.id === taskId)
        if (!task) return

        // 重置任务状态
        useAppStore.getState().updateFileStatus(task.fileId, FileStatus.PROCESSING, 0)

        // 重新执行任务
        await this.executeWorkflowTask(taskId)
    }

    // 工具函数已移除（未使用）

    /**
     * 获取任务统计信息
     */
    getTaskStats(): {
        total: number
        pending: number
        processing: number
        completed: number
        error: number
    } {
        const { tasks } = useAppStore.getState()

        return {
            total: tasks.length,
            pending: tasks.filter(t => t.status === FileStatus.PENDING).length,
            processing: tasks.filter(t => t.status === FileStatus.PROCESSING).length,
            completed: tasks.filter(t => t.status === FileStatus.COMPLETED).length,
            error: tasks.filter(t => t.status === FileStatus.ERROR).length
        }
    }
}

// 全局工作流服务实例
let workflowServiceInstance: WorkflowService | null = null

export const getWorkflowService = (): WorkflowService => {
    if (!workflowServiceInstance) {
        const config = useAppStore.getState().config.api
        workflowServiceInstance = new WorkflowService(config)
    }
    return workflowServiceInstance
}

export const updateWorkflowServiceConfig = (apiConfig: APIConfig): void => {
    if (workflowServiceInstance) {
        workflowServiceInstance.updateConfig(apiConfig)
    }
}
