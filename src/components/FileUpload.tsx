import React, { useCallback, useState, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Upload, FileText, CheckCircle2, AlertCircle, X, Link, Type, FileUp, Image as ImageIcon } from 'lucide-react'
import { useAppStore } from '@/stores/appStore'
import { cn, formatFileSize } from '@/lib/utils'
import { FileStatus } from '@/types'
import { APIService } from '@/services/apiService'

export const FileUpload: React.FC = () => {
    const {
        config,
        files,
        selectedFiles,
        addFiles,
        addTextItem,
        addUrlItem,
        removeFile,
        removeAllFiles,
        selectFile,
        deselectFile,
        selectAllFiles,
        deselectAllFiles,
        setCurrentView
    } = useAppStore()

    const [inputMode, setInputMode] = useState<'file' | 'text' | 'url'>('file')
    const [textInput, setTextInput] = useState('')
    const [urlInput, setUrlInput] = useState('')
    const [isUploading, setIsUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const onDrop = useCallback((acceptedFiles: File[]) => {
        addFiles(acceptedFiles)
    }, [addFiles])

    const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
        onDrop,
        accept: {
            'text/*': config.supportedTypes.filter(t => t.startsWith('.'))
        },
        maxSize: config.maxFileSize
    })

    const handleTextSubmit = () => {
        // 中文注释：支持按空行分隔多条内容
        const raw = textInput
        const trimmed = raw.trim()
        if (!trimmed) return
        // 以一个或多个“空行”作为分隔符，兼容 Windows/Unix 换行
        const segments = raw
            .split(/\r?\n\s*\r?\n+/)
            .map(s => s.trim())
            .filter(Boolean)

        if (segments.length > 1) {
            segments.forEach(s => addTextItem(s))
        } else {
            addTextItem(trimmed)
        }
        setTextInput('')
    }

    const handleUrlSubmit = () => {
        if (urlInput.trim()) {
            addUrlItem(urlInput.trim())
            setUrlInput('')
        }
    }

    const handleImageUpload = async () => {
        if (!fileInputRef.current) return
        fileInputRef.current.click()
    }

    const handleImageFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        if (files.length === 0) return

        setIsUploading(true)
        const api = new APIService(config.api)
        const uploadTasks: Array<{
            id: string
            file: File
            promise: Promise<string>
        }> = []
        const chosenBgIndex = Math.floor(Math.random() * 3)

        for (const file of files) {
            const taskId = file.name + Date.now()
            uploadTasks.push({
                id: taskId,
                file,
                promise: api.uploadImageWithBackground(file, {
                    endpoint: config.imageUploadEndpoint,
                    apiKey: config.imageUploadApiKey,
                    bgIndex: chosenBgIndex
                })
            })
        }

        const results = await Promise.allSettled(uploadTasks.map(t => t.promise))
        const successUrls: string[] = []
        const failedFiles: string[] = []

        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                successUrls.push(result.value)
            } else {
                failedFiles.push(uploadTasks[index].file.name)
            }
        })

        if (successUrls.length > 0) {
            // 将成功的图片URL添加为文本项
            const urlList = successUrls.join('\n')
            addTextItem(`已上传图片列表：\n${urlList}`)
            alert(`成功上传 ${successUrls.length} 张图片`)
        }

        if (failedFiles.length > 0) {
            alert(`有 ${failedFiles.length} 张上传失败：\n${failedFiles.join('\n')}`)
        }

        setIsUploading(false)
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    const handleRemoveFile = (fileId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        removeFile(fileId)
    }

    const handleSelectAll = () => {
        if (selectedFiles.length === files.length) {
            deselectAllFiles()
        } else {
            selectAllFiles()
        }
    }

    const getFileIcon = (file: any) => {
        if (file.sourceType === 'text') return <Type className="h-5 w-5" />
        if (file.sourceType === 'url') return <Link className="h-5 w-5" />
        return <FileText className="h-5 w-5" />
    }

    const getStatusIcon = (status: FileStatus) => {
        switch (status) {
            case FileStatus.COMPLETED:
                return <CheckCircle2 className="h-4 w-4 text-green-500" />
            case FileStatus.ERROR:
                return <AlertCircle className="h-4 w-4 text-red-500" />
            default:
                return null
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>上传文件</CardTitle>
                    <CardDescription>
                        支持拖拽上传，支持的格式：{config.supportedTypes.join(', ')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* 输入模式切换 */}
                    <div className="flex gap-2 mb-4">
                        <Button
                            variant={inputMode === 'file' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setInputMode('file')}
                        >
                            <FileUp className="h-4 w-4 mr-1" />
                            文件上传
                        </Button>
                        <Button
                            variant={inputMode === 'text' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setInputMode('text')}
                        >
                            <Type className="h-4 w-4 mr-1" />
                            文本输入
                        </Button>
                        <Button
                            variant={inputMode === 'url' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setInputMode('url')}
                        >
                            <Link className="h-4 w-4 mr-1" />
                            URL输入
                        </Button>
                    </div>

                    {/* 文件上传区域 */}
                    {inputMode === 'file' && (
                        <>
                            <div
                                {...getRootProps()}
                                className={cn(
                                    "border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all duration-200",
                                    isDragActive && !isDragReject && "dropzone-active",
                                    isDragReject && "dropzone-reject",
                                    !isDragActive && "border-gray-200 hover:border-primary"
                                )}
                            >
                                <input {...getInputProps()} />
                                <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                                <p className="text-gray-600 mb-2">
                                    {isDragActive
                                        ? isDragReject
                                            ? '不支持的文件格式'
                                            : '释放鼠标上传文件'
                                        : '拖拽文件到此处，或点击选择文件'}
                                </p>
                                <p className="text-sm text-gray-500">
                                    最大文件大小：{formatFileSize(config.maxFileSize)}
                                </p>
                            </div>

                            {/* 图片上传按钮 */}
                            <div className="flex items-center gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleImageFiles}
                                    style={{ display: 'none' }}
                                />
                                <Button
                                    variant="secondary"
                                    disabled={isUploading}
                                    onClick={handleImageUpload}
                                    className="flex items-center gap-2"
                                >
                                    <ImageIcon className="h-4 w-4" />
                                    {isUploading ? '正在上传图片...' : '上传图片到图床'}
                                </Button>
                            </div>
                        </>
                    )}

                    {/* 文本输入区域 */}
                    {inputMode === 'text' && (
                        <div className="space-y-4">
                            <textarea
                                className="w-full min-h-[200px] p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="在此输入文本内容（用空行分隔多条）..."
                                value={textInput}
                                onChange={(e) => setTextInput(e.target.value)}
                            />
                            <Button
                                onClick={handleTextSubmit}
                                disabled={!textInput.trim()}
                                className="w-full"
                            >
                                添加文本
                            </Button>
                        </div>
                    )}

                    {/* URL输入区域 */}
                    {inputMode === 'url' && (
                        <div className="space-y-4">
                            <Input
                                type="url"
                                placeholder="输入URL地址..."
                                value={urlInput}
                                onChange={(e) => setUrlInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleUrlSubmit()}
                            />
                            <Button
                                onClick={handleUrlSubmit}
                                disabled={!urlInput.trim()}
                                className="w-full"
                            >
                                添加URL
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 文件列表 */}
            {files.length > 0 && (
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                                <FileText className="h-5 w-5" />
                                已选择的文件 ({files.length})
                            </CardTitle>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleSelectAll}
                                >
                                    {selectedFiles.length === files.length ? '取消全选' : '全选'}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={removeAllFiles}
                                    className="text-destructive hover:text-destructive"
                                >
                                    清空列表
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {files.map(file => (
                                <div
                                    key={file.id}
                                    className={cn(
                                        "flex items-center gap-4 p-4 rounded-lg border transition-all duration-200 file-item-enter",
                                        selectedFiles.includes(file.id)
                                            ? "border-primary bg-primary/5"
                                            : "border-gray-200 hover:border-gray-300",
                                        "cursor-pointer"
                                    )}
                                    onClick={() => {
                                        if (selectedFiles.includes(file.id)) {
                                            deselectFile(file.id)
                                        } else {
                                            selectFile(file.id)
                                        }
                                    }}
                                >
                                    <div className="flex-shrink-0">
                                        {getFileIcon(file)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="font-medium truncate">{file.name}</p>
                                            {getStatusIcon(file.status)}
                                        </div>
                                        {file.size && (
                                            <p className="text-sm text-muted-foreground">
                                                {formatFileSize(file.size)}
                                            </p>
                                        )}
                                        {file.status === FileStatus.PROCESSING && (
                                            <Progress
                                                value={file.progress}
                                                className="h-1 mt-2"
                                            />
                                        )}
                                        {file.error && (
                                            <p className="text-sm text-red-500 mt-1">{file.error}</p>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => handleRemoveFile(file.id, e)}
                                        className="flex-shrink-0"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* 操作按钮 */}
            {selectedFiles.length > 0 && (
                <div className="flex justify-end">
                    <Button
                        size="lg"
                        onClick={() => setCurrentView('workflow')}
                        className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90"
                    >
                        开始处理 ({selectedFiles.length} 个文件)
                    </Button>
                </div>
            )}
        </div>
    )
}
