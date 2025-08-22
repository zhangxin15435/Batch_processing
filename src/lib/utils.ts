import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function downloadFile(content: string, filename: string, mimeType = 'text/markdown;charset=utf-8'): void {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')

    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()

    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

export function downloadImage(imageUrl: string, filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            // 检查是否是 data URL (base64 格式)
            if (imageUrl.startsWith('data:image/')) {
                console.log('下载 Base64 图片:', filename)
                const link = document.createElement('a')
                link.href = imageUrl
                link.download = filename
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                resolve()
                return
            }

            // 对于普通 URL，使用 fetch 获取
            fetch(imageUrl)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
                    }
                    return response.blob()
                })
                .then(blob => {
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')

                    a.href = url
                    a.download = filename
                    document.body.appendChild(a)
                    a.click()

                    document.body.removeChild(a)
                    URL.revokeObjectURL(url)
                    resolve()
                })
                .catch(error => {
                    console.error('图片下载失败:', error)
                    // 如果 fetch 失败，尝试直接使用链接下载
                    try {
                        const link = document.createElement('a')
                        link.href = imageUrl
                        link.download = filename
                        link.target = '_blank'
                        document.body.appendChild(link)
                        link.click()
                        document.body.removeChild(link)
                        resolve()
                    } catch (fallbackError) {
                        reject(new Error(`图片下载失败: ${error.message}`))
                    }
                })
        } catch (error) {
            reject(error)
        }
    })
}

export function generateId(): string {
    return Math.random().toString(36).substr(2, 9)
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export function formatRelativeTime(date: Date): string {
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (diffInSeconds < 60) {
        return '刚刚'
    } else if (diffInSeconds < 3600) {
        const minutes = Math.floor(diffInSeconds / 60)
        return `${minutes}分钟前`
    } else if (diffInSeconds < 86400) {
        const hours = Math.floor(diffInSeconds / 3600)
        return `${hours}小时前`
    } else {
        const days = Math.floor(diffInSeconds / 86400)
        return `${days}天前`
    }
}

// 将任意文本按 CSV 规则转义（逗号、双引号、换行）
function csvEscape(value: any): string {
    const s = value === null || value === undefined ? '' : String(value)
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
}

// 将 posts 数组转为 CSV 字符串（含表头），字段顺序与后端存储结构一致
export function postsToCsv(items: any[]): string {
    // 中文表头，避免歧义
    const headers = [
        'id', 'platform', 'keyword', 'author', 'url', 'title', 'desc', 'published_at',
        'likes', 'comments', 'shares', 'views', 'followers', 'fetched_at', 'score'
    ]
    const lines: string[] = []
    lines.push(headers.join(','))
    for (const it of items || []) {
        const row = [
            it.id || it.postId || '',
            it.platform || '',
            it.keyword || '',
            it.author || '',
            it.url || '',
            it.title || '',
            it.desc || '',
            it.published_at || '',
            it.likes ?? 0,
            it.comments ?? 0,
            it.shares ?? 0,
            it.views ?? 0,
            it.followers ?? 0,
            it.fetched_at || '',
            it.score ?? 0
        ].map(csvEscape)
        lines.push(row.join(','))
    }
    // 加入 UTF-8 BOM，避免 Excel 打开出现中文乱码
    return '\ufeff' + lines.join('\n')
}

// 便捷函数：直接导出为 CSV 文件
export function exportItemsToCsv(items: any[], filename: string): void {
    const csv = postsToCsv(items)
    downloadFile(csv, filename, 'text/csv;charset=utf-8')
}