import React from 'react'
import { Settings, Key, Server, Brain, FileText, Image as ImageIcon, RefreshCcw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore } from '@/stores/appStore'
import { listModels } from '@/services/apiService'
import { updateWorkflowServiceConfig } from '@/services/workflowService'

export const ConfigPanel: React.FC = () => {
    const { config, updateAPIConfig, updateConfig } = useAppStore()

    const handleAPIConfigChange = (field: string, value: string) => {
        const newConfig = { ...config.api, [field]: value }
        updateAPIConfig({ [field]: value })
        updateWorkflowServiceConfig(newConfig)
    }

    return (
        <Card className="card-hover">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    配置设置
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* API 配置 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* API Key */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <Key className="h-4 w-4" />
                            OpenAI API Key
                        </label>
                        <Input
                            type="password"
                            value={config.api.apiKey}
                            onChange={(e) => handleAPIConfigChange('apiKey', e.target.value)}
                            placeholder="请输入您的API Key"
                            className="font-mono"
                        />
                    </div>

                    {/* Base URL */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <Server className="h-4 w-4" />
                            API Base URL
                        </label>
                        <Input
                            type="url"
                            value={config.api.baseUrl}
                            onChange={(e) => handleAPIConfigChange('baseUrl', e.target.value)}
                            placeholder="https://api.openai.com/v1"
                        />
                    </div>
                </div>

                {/* 图床上传配置 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 图床 Endpoint */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <ImageIcon className="h-4 w-4" />
                            图床上传 Endpoint
                        </label>
                        <Input
                            type="url"
                            value={config.imageUploadEndpoint || ''}
                            onChange={(e) => updateConfig({ imageUploadEndpoint: e.target.value })}
                            placeholder="/api/v1/upload 或 https://your-domain.com/api/v1/upload"
                        />
                    </div>
                    {/* 图床 API Key */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <Key className="h-4 w-4" />
                            图床 API Key
                        </label>
                        <Input
                            type="password"
                            value={config.imageUploadApiKey || ''}
                            onChange={(e) => updateConfig({ imageUploadApiKey: e.target.value })}
                            placeholder="用于图床上传的 x-api-key"
                            className="font-mono"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 模型选择 */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <Brain className="h-4 w-4" />
                            选择模型
                        </label>
                        <div className="flex items-center gap-2">
                            <div className="flex-1">
                                <Select
                                    value={config.api.model}
                                    onValueChange={(value) => handleAPIConfigChange('model', value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="选择AI模型" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {config.models.map((model) => (
                                            <SelectItem key={model.id} value={model.id}>
                                                <div className="flex flex-col items-start">
                                                    <span className="font-medium">{model.name}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {model.description}
                                                    </span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <button
                                className="inline-flex items-center px-2 py-1 text-xs rounded border hover:bg-muted"
                                title="用当前 API Key 检测可用模型"
                                onClick={async () => {
                                    try {
                                        const models = await listModels(config.api)
                                        useAppStore.getState().setModels(models)
                                        alert(`已发现 ${models.length} 个模型`)
                                    } catch (e: any) {
                                        alert(`拉取模型失败：${e?.message || e}`)
                                    }
                                }}
                            >
                                <RefreshCcw className="h-3 w-3 mr-1" />检测模型
                            </button>
                        </div>
                    </div>

                    {/* 分析模板 */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <FileText className="h-4 w-4" />
                            分析模板
                        </label>
                        <Select
                            value={config.api.template}
                            onValueChange={(value) => handleAPIConfigChange('template', value)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="选择分析模板" />
                            </SelectTrigger>
                            <SelectContent>
                                {config.templates.map((template) => (
                                    <SelectItem key={template.id} value={template.id}>
                                        <div className="flex flex-col items-start">
                                            <span className="font-medium">{template.name}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {template.description}
                                            </span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* 配置信息卡片 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                    <div className="p-4 rounded-lg bg-muted/50">
                        <div className="text-sm text-muted-foreground">最大并发数</div>
                        <div className="text-lg font-semibold">{config.maxConcurrent}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50">
                        <div className="text-sm text-muted-foreground">重试次数</div>
                        <div className="text-lg font-semibold">{config.retryAttempts}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50">
                        <div className="text-sm text-muted-foreground">文件大小限制</div>
                        <div className="text-lg font-semibold">
                            {(config.maxFileSize / 1024 / 1024).toFixed(1)}MB
                        </div>
                    </div>
                </div>

                {/* 支持的文件类型 */}
                <div className="space-y-2">
                    <div className="text-sm font-medium">支持的文件类型</div>
                    <div className="flex flex-wrap gap-2">
                        {config.supportedTypes.map((type) => (
                            <span
                                key={type}
                                className="px-2 py-1 bg-primary/10 text-primary rounded text-xs font-medium"
                            >
                                {type}
                            </span>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
