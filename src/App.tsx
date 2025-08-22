import { useState } from 'react'
// 移除未使用的 Tabs 组件导入，避免构建报错
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Upload, Settings, Play, BarChart3, Menu, X, Search } from 'lucide-react'
import { FileUpload } from '@/components/FileUpload'
import { ConfigPanel } from '@/components/ConfigPanel'
import { WorkflowPanel } from '@/components/WorkflowPanel'
import { ResultsPanel } from '@/components/ResultsPanel'
import { SourcingPanel } from '@/components/SourcingPanel'
import { useAppStore } from '@/stores/appStore'
import { cn } from '@/lib/utils'

function App() {
    const [activeTab, setActiveTab] = useState('upload')
    const [sidebarOpen, setSidebarOpen] = useState(true)
    const { stats, isProcessing } = useAppStore()

    const tabs = [
        {
            id: 'upload',
            label: '文件上传',
            icon: Upload,
            component: FileUpload
        },
        {
            id: 'sourcing',
            label: '选题发现',
            icon: Search,
            component: SourcingPanel
        },
        {
            id: 'workflow',
            label: '工作流程',
            icon: Play,
            component: WorkflowPanel,
            badge: stats.totalFiles > 0 ? stats.totalFiles : undefined
        },
        {
            id: 'results',
            label: '处理结果',
            icon: BarChart3,
            component: ResultsPanel,
            badge: stats.completedTasks > 0 ? stats.completedTasks : undefined
        },
        {
            id: 'config',
            label: '配置设置',
            icon: Settings,
            component: ConfigPanel
        }
    ]

    const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component || FileUpload

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
            {/* 头部导航 */}
            <header className="bg-white/80 backdrop-blur-custom border-b shadow-sm sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        {/* Logo和标题 */}
                        <div className="flex items-center gap-3">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSidebarOpen(!sidebarOpen)}
                                className="md:hidden"
                            >
                                {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                            </Button>
                            <div className="flex items-center gap-3">
                                <div className="text-2xl">🤖</div>
                                <div>
                                    <h1 className="text-xl font-bold text-gradient">
                                        批量文件AI分析处理工具
                                    </h1>
                                    <p className="text-sm text-muted-foreground hidden sm:block">
                                        使用AI模型批量分析文件，生成详细的内容报告
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* 状态指示器 */}
                        <div className="flex items-center gap-4">
                            {isProcessing && (
                                <div className="flex items-center gap-2 text-blue-600">
                                    <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
                                    <span className="text-sm font-medium">处理中...</span>
                                </div>
                            )}

                            {/* 统计信息 */}
                            <div className="hidden sm:flex items-center gap-4 text-sm">
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    <span>已完成: {stats.completedTasks}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                    <span>错误: {stats.errorTasks}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
                <div className="flex gap-6">
                    {/* 侧边栏导航 */}
                    <aside className={cn(
                        "w-64 space-y-2 transition-all duration-300",
                        sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
                        "fixed md:static left-0 top-16 bottom-0 bg-white/80 backdrop-blur-custom border-r md:border-r-0 md:bg-transparent z-40 p-4 md:p-0"
                    )}>
                        {/* 导航菜单 */}
                        <nav className="space-y-1">
                            {tabs.map((tab) => {
                                const Icon = tab.icon
                                return (
                                    <Button
                                        key={tab.id}
                                        variant={activeTab === tab.id ? "default" : "ghost"}
                                        className={cn(
                                            "w-full justify-start gap-3 h-12",
                                            activeTab === tab.id && "shadow-lg"
                                        )}
                                        onClick={() => {
                                            setActiveTab(tab.id)
                                            setSidebarOpen(false) // 移动端点击后关闭侧边栏
                                        }}
                                    >
                                        <Icon className="h-5 w-5" />
                                        <span className="flex-1 text-left">{tab.label}</span>
                                        {tab.badge && (
                                            <span className="bg-primary/20 text-primary text-xs px-2 py-1 rounded-full">
                                                {tab.badge}
                                            </span>
                                        )}
                                    </Button>
                                )
                            })}
                        </nav>

                        {/* 快捷统计 */}
                        <Card className="mt-6">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm">统计信息</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">总文件数</span>
                                    <span className="font-medium">{stats.totalFiles}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">已完成</span>
                                    <span className="font-medium text-green-600">{stats.completedTasks}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">失败任务</span>
                                    <span className="font-medium text-red-600">{stats.errorTasks}</span>
                                </div>
                                <div className="pt-2 border-t">
                                    <div className="flex justify-between text-sm mb-2">
                                        <span className="text-muted-foreground">总进度</span>
                                        <span className="font-medium">{Math.round(stats.totalProgress)}%</span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2">
                                        <div
                                            className="bg-gradient-to-r from-primary to-purple-600 h-2 rounded-full transition-all duration-300"
                                            style={{ width: `${stats.totalProgress}%` }}
                                        ></div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </aside>

                    {/* 遮罩层 */}
                    {sidebarOpen && (
                        <div
                            className="fixed inset-0 bg-black/20 z-30 md:hidden"
                            onClick={() => setSidebarOpen(false)}
                        />
                    )}

                    {/* 主内容区域 */}
                    <main className="flex-1 min-w-0">
                        <div className="space-y-6">
                            {/* 页面标题 */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-2xl font-bold">
                                        {tabs.find(tab => tab.id === activeTab)?.label}
                                    </h2>
                                    <p className="text-muted-foreground mt-1">
                                        {activeTab === 'upload' && '上传文件开始分析处理'}
                                        {activeTab === 'sourcing' && '手动触发抓取并发现热门选题'}
                                        {activeTab === 'workflow' && '管理和监控文件处理流程'}
                                        {activeTab === 'results' && '查看和下载处理结果'}
                                        {activeTab === 'config' && '配置API和处理参数'}
                                    </p>
                                </div>

                                {/* 快捷操作 */}
                                <div className="flex items-center gap-2">
                                    {activeTab === 'upload' && stats.totalFiles > 0 && (
                                        <Button
                                            onClick={() => setActiveTab('workflow')}
                                            variant="gradient"
                                        >
                                            开始处理
                                        </Button>
                                    )}
                                    {activeTab === 'results' && stats.completedTasks > 0 && (
                                        <Button variant="outline">
                                            <BarChart3 className="h-4 w-4 mr-2" />
                                            导出报告
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {/* 动态内容区域 */}
                            <div className="animate-fade-in">
                                <ActiveComponent />
                            </div>
                        </div>
                    </main>
                </div>
            </div>
        </div>
    )
}

export default App
