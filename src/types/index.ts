// 文件状态枚举
export enum FileStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    ERROR = 'error',
    CANCELLED = 'cancelled'
}

// 工作流步骤枚举
export enum WorkflowStep {
    CONTENT_GENERATION = 'content_generation',
    IMAGE_GENERATION = 'image_generation',
    DOCUMENT_GENERATION = 'document_generation'
}

// 工作流步骤状态
export enum WorkflowStepStatus {
    PENDING = 'pending',
    ACTIVE = 'active',
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    ERROR = 'error'
}

// AI模型接口
export interface AIModel {
    id: string
    name: string
    description: string
    provider?: string
}

// 分析模板接口
export interface AnalysisTemplate {
    id: string
    name: string
    description: string
    prompt: string
}

// 文件接口
export interface FileItem {
    id: string
    // 源类型：文件 / 纯文本 / URL
    sourceType: 'file' | 'text' | 'url'
    // 当为文件时存在
    file?: File
    // 当为文本/URL时的原始内容或链接
    rawContent?: string
    url?: string
    // 通用展示信息
    name: string
    size?: number
    type?: string
    status: FileStatus
    progress: number
    error?: string
    createdAt: Date
    updatedAt: Date
}

// 任务结果接口
export interface TaskResult {
    id: string
    fileId: string
    step: WorkflowStep
    content: string
    metadata?: Record<string, any>
    createdAt: Date
}

// 工作流任务接口
export interface WorkflowTask {
    id: string
    fileId: string
    // 绑定数据库唯一记录ID，确保一张卡片只对应一条记录
    recordId?: string
    // 任务级背景索引（用于示例图统一背景，0/1）
    bgIndex?: number
    steps: WorkflowStepConfig[]
    currentStep: number
    status: FileStatus
    progress: number
    results: TaskResult[]
    error?: string
    createdAt: Date
    updatedAt: Date
}

// 工作流步骤配置
export interface WorkflowStepConfig {
    step: WorkflowStep
    status: WorkflowStepStatus
    progress: number
    templateId?: string
    config?: Record<string, any>
    result?: TaskResult
    error?: string
}

// API配置接口
export interface APIConfig {
    apiKey: string
    baseUrl: string
    model: string
    template: string
}

// 应用配置接口
export interface AppConfig {
    api: APIConfig
    maxConcurrent: number
    retryAttempts: number
    maxFileSize: number
    supportedTypes: string[]
    models: AIModel[]
    templates: AnalysisTemplate[]
    // 图床上传配置
    imageUploadEndpoint?: string
    imageUploadApiKey?: string
}

// 应用状态接口
export interface AppState {
    // 配置
    config: AppConfig

    // 文件管理
    files: FileItem[]
    selectedFiles: string[]

    // 任务管理
    tasks: WorkflowTask[]
    activeTaskIds: string[]

    // UI状态
    isProcessing: boolean
    currentView: 'upload' | 'workflow' | 'results'
    sidebarOpen: boolean

    // 统计信息
    stats: {
        totalFiles: number
        completedTasks: number
        errorTasks: number
        totalProgress: number
    }
}

// API响应接口
export interface APIResponse {
    success: boolean
    data?: any
    error?: string
    usage?: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
    }
}

// 图像生成结果
export interface ImageGenerationResult {
    url: string
    b64_json?: string
    prompt: string
    size: string
    quality: string
}

// 导出下载项
export interface DownloadItem {
    id: string
    name: string
    content: string
    type: 'text' | 'image'
    url?: string
    size: number
    createdAt: Date
}
