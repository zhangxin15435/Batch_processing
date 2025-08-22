import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
    AppState,
    FileItem,
    WorkflowTask,
    FileStatus,
    WorkflowStep,
    WorkflowStepStatus,
    APIConfig,
    AppConfig,
    AIModel
} from '@/types'
import { generateId } from '@/lib/utils'
import { TUTORIAL_TO_PROMPT } from '@/prompts/tutorialToPrompt'

// 默认配置
const DEFAULT_CONFIG: AppConfig = {
    api: {
        apiKey: '',
        baseUrl: 'https://oneapi.basevec.com/v1',
        model: 'gpt-4o',
        template: 'molyhub_prompt_db'
    },
    maxConcurrent: 3,
    retryAttempts: 3,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    supportedTypes: ['.txt', '.md', '.json', '.csv', '.xml', '.html', '.js', '.py', '.java', '.cpp', '.c'],
    models: [
        { id: 'chatgpt-4o-latest', name: 'ChatGPT-4o Latest', description: 'OpenAI 最新 4o 能力，综合表现最佳' },
        { id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI 多模态旗舰（文本/视觉/语音）' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: '性价比更高的 4o 轻量版' },
        { id: 'gpt-4.5-preview', name: 'GPT-4.5 Preview', description: '更强推理与指令跟随（预览）' },
        { id: 'o3-mini', name: 'O3 Mini', description: 'OpenAI O 系列小型高效模型（推理友好）' },
        { id: 'o3-pro', name: 'O3 Pro', description: 'OpenAI O 系列专业版（更强推理/工具使用）' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'GPT-4 增强版，平衡性能与速度' },
        { id: 'gpt-4', name: 'GPT-4', description: '经典 GPT-4，稳健强大' },
        { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Anthropic最新模型，优秀的分析能力' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Google最新模型，高效快速' },
        { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', description: 'DeepSeek对话模型，中文友好' },
        { id: 'qwen/qwen-max', name: '通义千问 Max', description: '阿里通义千问最强版本' }
    ],
    templates: [
        // 不再内嵌大段提示词，仅保留一个占位引用，实际内容来自 src/prompts/molyhub.ts
        { id: 'molyhub_prompt_db', name: 'MolyHub Prompt → DB Generator', description: 'Generate workflow content + cover prompt; save to DB', prompt: '' },
        // Tutorial to Prompt 转换器：将教程文章转换为可执行的提示词（仅用于URL预处理）
        { id: 'tutorial_to_prompt', name: 'Tutorial → Prompt Converter', description: 'Convert tutorial articles into executable AI prompts', prompt: TUTORIAL_TO_PROMPT }
    ],
    // 图床上传配置默认值（可在配置面板中覆盖）
    imageUploadEndpoint: '',
    imageUploadApiKey: ''
}

interface AppStore extends AppState {
    // 配置相关
    updateAPIConfig: (config: Partial<APIConfig>) => void
    updateConfig: (config: Partial<AppConfig>) => void
    // 动态模型：拉取并合并模型选项
    setModels: (models: AIModel[]) => void

    // 文件管理
    addFiles: (files: File[]) => void
    // 文本与URL条目
    addTextItem: (text: string) => void
    addUrlItem: (url: string) => void
    removeFile: (fileId: string) => void
    removeAllFiles: () => void
    updateFileStatus: (fileId: string, status: FileStatus, progress?: number, error?: string) => void
    selectFile: (fileId: string) => void
    selectAllFiles: () => void
    deselectFile: (fileId: string) => void
    deselectAllFiles: () => void

    // 任务管理
    createWorkflowTask: (fileId: string) => string
    setTaskStatus: (taskId: string, status: FileStatus) => void
    updateTaskStep: (taskId: string, stepIndex: number, status: WorkflowStepStatus, progress?: number, error?: string) => void
    addTaskResult: (taskId: string, step: WorkflowStep, content: string, metadata?: Record<string, any>) => void
    removeTask: (taskId: string) => void
    removeAllTasks: () => void

    // UI状态
    setCurrentView: (view: 'upload' | 'workflow' | 'results') => void
    setProcessing: (isProcessing: boolean) => void
    setSidebarOpen: (open: boolean) => void

    // 统计信息更新
    updateStats: () => void
}

export const useAppStore = create<AppStore>()(
    devtools(
        (set, get) => ({
            // 初始状态
            config: DEFAULT_CONFIG,
            files: [],
            selectedFiles: [],
            tasks: [],
            activeTaskIds: [],
            isProcessing: false,
            currentView: 'upload',
            sidebarOpen: true,
            stats: {
                totalFiles: 0,
                completedTasks: 0,
                errorTasks: 0,
                totalProgress: 0
            },

            // 配置相关
            updateAPIConfig: (apiConfig) => {
                set((state) => ({
                    config: {
                        ...state.config,
                        api: { ...state.config.api, ...apiConfig }
                    }
                }))
            },

            updateConfig: (config) => {
                set((state) => ({
                    config: { ...state.config, ...config }
                }))
            },

            setModels: (models) => {
                set((state) => ({
                    config: { ...state.config, models: models }
                }))
            },

            // 文件管理
            addFiles: (newFiles) => {
                const validFiles = newFiles.filter(file => {
                    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
                    const isValidType = get().config.supportedTypes.includes(ext)
                    const isValidSize = file.size <= get().config.maxFileSize
                    return isValidType && isValidSize
                })

                const fileItems: FileItem[] = validFiles.map(file => ({
                    id: generateId(),
                    sourceType: 'file',
                    file,
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    status: FileStatus.PENDING,
                    progress: 0,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }))

                set((state) => ({
                    files: [...state.files, ...fileItems],
                    selectedFiles: [...state.selectedFiles, ...fileItems.map(f => f.id)]
                }))

                get().updateStats()
            },
            // 新增：添加文本条目
            addTextItem: (text: string) => {
                const id = generateId()
                const item: FileItem = {
                    id,
                    sourceType: 'text',
                    rawContent: text,
                    name: `文本_${id.slice(0, 4)}.txt`,
                    status: FileStatus.PENDING,
                    progress: 0,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
                set((state) => ({
                    files: [...state.files, item],
                    selectedFiles: [...state.selectedFiles, id]
                }))
                get().updateStats()
            },
            // 新增：添加 URL 条目
            addUrlItem: (url: string) => {
                const id = generateId()
                const item: FileItem = {
                    id,
                    sourceType: 'url',
                    url,
                    name: url,
                    status: FileStatus.PENDING,
                    progress: 0,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
                set((state) => ({
                    files: [...state.files, item],
                    selectedFiles: [...state.selectedFiles, id]
                }))
                get().updateStats()
            },

            removeFile: (fileId) => {
                set((state) => ({
                    files: state.files.filter(f => f.id !== fileId),
                    selectedFiles: state.selectedFiles.filter(id => id !== fileId),
                    tasks: state.tasks.filter(t => t.fileId !== fileId)
                }))
                get().updateStats()
            },

            removeAllFiles: () => {
                set({
                    files: [],
                    selectedFiles: [],
                    tasks: [],
                    activeTaskIds: []
                })
                get().updateStats()
            },

            updateFileStatus: (fileId, status, progress, error) => {
                set((state) => ({
                    files: state.files.map(file =>
                        file.id === fileId
                            ? {
                                ...file,
                                status,
                                progress: progress ?? file.progress,
                                error,
                                updatedAt: new Date()
                            }
                            : file
                    )
                }))
                get().updateStats()
            },

            selectFile: (fileId) => {
                set((state) => ({
                    selectedFiles: state.selectedFiles.includes(fileId)
                        ? state.selectedFiles
                        : [...state.selectedFiles, fileId]
                }))
            },

            selectAllFiles: () => {
                set((state) => ({
                    selectedFiles: state.files.map(f => f.id)
                }))
            },

            deselectFile: (fileId) => {
                set((state) => ({
                    selectedFiles: state.selectedFiles.filter(id => id !== fileId)
                }))
            },

            deselectAllFiles: () => {
                set({ selectedFiles: [] })
            },

            // 任务管理
            createWorkflowTask: (fileId) => {
                const taskId = generateId()
                const task: WorkflowTask = {
                    id: taskId,
                    fileId,
                    recordId: `rec_${fileId}`,
                    // 为当前任务生成 0~2 的随机背景索引，确保在三张背景中随机且同任务一致
                    bgIndex: Math.floor(Math.random() * 3),
                    steps: [
                        {
                            step: WorkflowStep.CONTENT_GENERATION,
                            status: WorkflowStepStatus.PENDING,
                            progress: 0,
                            templateId: 'molyhub_prompt_db'
                        },
                        {
                            step: WorkflowStep.IMAGE_GENERATION,
                            status: WorkflowStepStatus.PENDING,
                            progress: 0
                        },
                        // 移除单独的文档生成步骤（已并入步骤一）
                    ],
                    currentStep: 0,
                    status: FileStatus.PENDING,
                    progress: 0,
                    results: [],
                    createdAt: new Date(),
                    updatedAt: new Date()
                }

                set((state) => ({
                    tasks: [...state.tasks, task]
                }))

                return taskId
            },

            setTaskStatus: (taskId, status) => {
                set((state) => ({
                    tasks: state.tasks.map(task =>
                        task.id === taskId
                            ? { ...task, status, updatedAt: new Date() }
                            : task
                    )
                }))
            },

            updateTaskStep: (taskId, stepIndex, status, progress, error) => {
                set((state) => ({
                    tasks: state.tasks.map(task =>
                        task.id === taskId
                            ? {
                                ...task,
                                steps: task.steps.map((step, index) =>
                                    index === stepIndex
                                        ? { ...step, status, progress: progress ?? step.progress, error }
                                        : step
                                ),
                                updatedAt: new Date()
                            }
                            : task
                    )
                }))
            },

            addTaskResult: (taskId, step, content, metadata) => {
                const result = {
                    id: generateId(),
                    fileId: get().tasks.find(t => t.id === taskId)?.fileId || '',
                    step,
                    content,
                    metadata,
                    createdAt: new Date()
                }

                set((state) => ({
                    tasks: state.tasks.map(task =>
                        task.id === taskId
                            ? {
                                ...task,
                                results: [...task.results, result],
                                updatedAt: new Date()
                            }
                            : task
                    )
                }))
            },

            removeTask: (taskId) => {
                set((state) => ({
                    tasks: state.tasks.filter(t => t.id !== taskId),
                    activeTaskIds: state.activeTaskIds.filter(id => id !== taskId)
                }))
            },

            removeAllTasks: () => {
                set({
                    tasks: [],
                    activeTaskIds: []
                })
            },

            // UI状态
            setCurrentView: (view) => {
                set({ currentView: view })
            },

            setProcessing: (isProcessing) => {
                set({ isProcessing })
            },

            setSidebarOpen: (open) => {
                set({ sidebarOpen: open })
            },

            // 统计信息更新
            updateStats: () => {
                const { files, tasks } = get()
                const completedTasks = tasks.filter(t => t.status === FileStatus.COMPLETED).length
                const errorTasks = tasks.filter(t => t.status === FileStatus.ERROR).length
                const totalProgress = files.length > 0
                    ? files.reduce((sum, file) => sum + file.progress, 0) / files.length
                    : 0

                set({
                    stats: {
                        totalFiles: files.length,
                        completedTasks,
                        errorTasks,
                        totalProgress
                    }
                })
            }
        })
    )
)
