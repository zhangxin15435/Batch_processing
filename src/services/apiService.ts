import { APIConfig, AIModel, ImageGenerationResult } from '@/types'
import { useAppStore } from '@/stores/appStore'

export class APIService {
    private config: APIConfig

    constructor(config: APIConfig) {
        this.config = config
    }

    updateConfig(config: APIConfig) {
        this.config = config
    }

    /**
     * 调用文本生成API
     */
    async generateText(content: string, prompt: string): Promise<string> {
        const maxRetries = 3
        const timeoutMs = 30000
        let lastError: Error | null = null

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const controller = new AbortController()
                const timer = setTimeout(() => controller.abort(), timeoutMs)
                const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.config.apiKey}`
                    },
                    body: JSON.stringify({
                        model: this.config.model,
                        messages: [
                            {
                                role: 'system',
                                content: prompt
                            },
                            {
                                role: 'user',
                                content: content
                            }
                        ],
                        temperature: 0.7,
                        max_tokens: 4000
                    }),
                    signal: controller.signal
                }).finally(() => clearTimeout(timer))

                if (!response.ok) {
                    const errorData = await response.text()
                    throw new Error(`API调用失败 (${response.status}): ${errorData}`)
                }

                const data = await response.json()

                if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                    throw new Error('API响应格式异常')
                }

                return data.choices[0].message.content

            } catch (error) {
                lastError = error as Error
                if (attempt < maxRetries - 1) {
                    // 等待后重试，递增延迟
                    await this.delay(1000 * (attempt + 1))
                }
            }
        }

        throw lastError || new Error('未知错误')
    }

    /**
     * 调用图像生成API
     */
    async generateImage(prompt: string): Promise<ImageGenerationResult> {
        try {
            // 确保提示词包含 3:4 比例要求（若用户/上游未显式指定）
            const enforcedPrompt = /(--ar\s*\d+\s*:\s*\d+|3\s*:\s*4|3：4)/i.test(prompt)
                ? prompt
                : `${prompt} --ar 3:4`

            // 优先请求 3:4 尺寸；若后端不支持再回退到 1024x1024
            const preferredSize = '768x1024'
            let attemptedSize = preferredSize
            let response = await fetch(`${this.config.baseUrl}/images/generations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                body: JSON.stringify({
                    model: 'imagen-3.0-generate-002',
                    prompt: enforcedPrompt,
                    n: 1,
                    size: preferredSize,
                    quality: 'standard',
                    response_format: 'b64_json'
                })
            })

            if (!response.ok) {
                const errTxt = await response.text().catch(() => '')
                // 若提示尺寸不被接受，则自动回退
                if (/size|dimension|unsupported/i.test(errTxt) || response.status === 400) {
                    attemptedSize = '1024x1024'
                    response = await fetch(`${this.config.baseUrl}/images/generations`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.config.apiKey}`
                        },
                        body: JSON.stringify({
                            model: 'imagen-3.0-generate-002',
                            prompt: enforcedPrompt,
                            n: 1,
                            size: attemptedSize,
                            quality: 'standard',
                            response_format: 'b64_json'
                        })
                    })
                } else {
                    throw new Error(`图像生成失败 (${response.status}): ${errTxt}`)
                }
            }

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`图像生成失败 (${response.status}): ${errorText}`)
            }

            const data = await response.json()

            // 处理不同的响应格式
            if (data.data && data.data[0]) {
                const imageData = data.data[0]

                // Base64格式优先
                if (imageData.b64_json) {
                    let url = `data:image/png;base64,${imageData.b64_json}`
                    // 无论后端返回何种尺寸，这里强制裁切/填充为 3:4（768x1024）
                    const enforcedUrl = await this.enforceAspectRatio(url, 768, 1024, 'cover')
                    const b64 = enforcedUrl.split(',').pop() || undefined
                    return {
                        url: enforcedUrl,
                        b64_json: b64,
                        prompt: enforcedPrompt,
                        size: '768x1024',
                        quality: 'standard'
                    }
                }

                // URL格式备选
                if (imageData.url) {
                    // 拉取为 Blob 再裁切，避免跨域 canvas 污染
                    let url = await this.fetchAsDataUrl(imageData.url)
                    const enforcedUrl = await this.enforceAspectRatio(url, 768, 1024, 'cover')
                    const b64 = enforcedUrl.split(',').pop() || undefined
                    return {
                        url: enforcedUrl,
                        b64_json: b64,
                        prompt: enforcedPrompt,
                        size: '768x1024',
                        quality: 'standard'
                    }
                }
            }

            throw new Error('API返回了数据，但无法找到图像URL或Base64数据')

        } catch (error) {
            console.error('图像生成失败:', error)
            throw error
        }
    }

    // 将任意图片 URL（含 DataURL）强制转换为指定宽高（默认 cover 居中裁切），返回 DataURL(PNG)
    private async enforceAspectRatio(inputUrl: string, targetWidth: number, targetHeight: number, mode: 'cover' | 'contain' = 'cover'): Promise<string> {
        // 如果本身就是 3:4，并且尺寸匹配，可直接返回
        try {
            const img = await this.loadImage(inputUrl)
            const srcW = img.naturalWidth || img.width
            const srcH = img.naturalHeight || img.height
            const srcAR = srcW / Math.max(1, srcH)
            const tgtAR = targetWidth / targetHeight

            const canvas = document.createElement('canvas')
            canvas.width = targetWidth
            canvas.height = targetHeight
            const ctx = canvas.getContext('2d')!
            ctx.clearRect(0, 0, targetWidth, targetHeight)

            if (mode === 'contain') {
                // 留白（上下或左右）
                const scale = Math.min(targetWidth / srcW, targetHeight / srcH)
                const drawW = Math.round(srcW * scale)
                const drawH = Math.round(srcH * scale)
                const dx = Math.round((targetWidth - drawW) / 2)
                const dy = Math.round((targetHeight - drawH) / 2)
                ctx.drawImage(img as any, 0, 0, srcW, srcH, dx, dy, drawW, drawH)
            } else {
                // cover：中心裁切并铺满
                let sx = 0, sy = 0, sw = srcW, sh = srcH
                if (srcAR > tgtAR) {
                    // 比目标更宽，裁宽度
                    sw = Math.round(srcH * tgtAR)
                    sx = Math.round((srcW - sw) / 2)
                } else if (srcAR < tgtAR) {
                    // 比目标更高，裁高度
                    sh = Math.round(srcW / tgtAR)
                    sy = Math.round((srcH - sh) / 2)
                }
                ctx.drawImage(img as any, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
            }

            return canvas.toDataURL('image/png')
        } catch {
            // 任意失败则直接返回原图
            return inputUrl
        }
    }

    private async fetchAsDataUrl(url: string): Promise<string> {
        const r = await fetch(url)
        if (!r.ok) return url
        const blob = await r.blob()
        return await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result || ''))
            reader.onerror = () => resolve(url)
            reader.readAsDataURL(blob)
        })
    }

    private loadImage(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = () => reject(new Error('图片加载失败'))
            img.src = src
        })
    }

    /**
     * 读取文件内容
     */
    async readFileContent(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = (e) => resolve(e.target?.result as string)
            reader.onerror = () => reject(new Error('文件读取失败'))
            reader.readAsText(file, 'UTF-8')
        })
    }

    /**
     * 将文件读取为 DataURL（用于避免大文件 base64 转码时的展开导致的调用栈溢出）
     */
    private readFileAsDataURL(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => reject(new Error('文件读取失败'))
            reader.readAsDataURL(file)
        })
    }

    /**
     * 读取 FileItem 内容（支持 file/text/url 三种来源）
     */
    async readItemContent(item: { sourceType: 'file' | 'text' | 'url'; file?: File; rawContent?: string; url?: string }): Promise<string> {
        if (item.sourceType === 'file' && item.file) {
            return this.readFileContent(item.file)
        }
        if (item.sourceType === 'text' && item.rawContent) {
            return item.rawContent
        }
        if (item.sourceType === 'url' && item.url) {
            // 使用后端代理获取URL内容，避免CORS问题
            const res = await fetch('/api/content/fetch-url', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: item.url })
            })

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: 'URL获取失败' }))
                throw new Error(errorData.error || `URL获取失败: ${res.status}`)
            }

            const data = await res.json()
            if (!data.success || !data.content) {
                throw new Error('URL内容获取失败或内容为空')
            }

            return data.content
        }
        throw new Error('无效的内容来源')
    }

    /**
     * 延迟函数
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * 上传图片到图床服务，返回直链 URL
     */
    async uploadImageToHosting(file: File, endpointOverride?: string, apiKeyOverride?: string): Promise<string> {
        // 优先使用传入值，其次使用 window 注入的兜底
        const endpoint = endpointOverride || (window as any).__IMAGE_UPLOAD_ENDPOINT__ || (useAppStore?.getState?.()?.config?.imageUploadEndpoint) || '/api/v1/upload'
        const apiKey = apiKeyOverride || (window as any).__IMAGE_UPLOAD_API_KEY__ || (useAppStore?.getState?.()?.config?.imageUploadApiKey) || ''

        // 通过后端代理避免 CORS 与密钥暴露
        // 注意：不要使用 String.fromCharCode(...Uint8Array) 的展开方式，
        // 对大文件会触发 "Maximum call stack size exceeded"
        const dataUrl = await this.readFileAsDataURL(file)
        const proxyResp = await fetch('/api/image/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: file.name,
                mime: file.type || 'application/octet-stream',
                // 直接传递 DataURL，服务端会解析出 Base64
                data: dataUrl,
                endpoint,
                apiKey
            })
        })
        const result = await proxyResp.json().catch(() => ({}))
        if (!proxyResp.ok || !result?.success || !result?.data?.url) {
            const msg = result?.error || result?.message || `上传失败(${proxyResp.status})`
            throw new Error(msg)
        }
        return result.data.url as string
    }

    /**
     * 合成背景后上传到图床（服务端合成，避免前端跨域与像素处理开销）
     * - bgUrl 可不传，服务端会在项目内置的两张背景中选择；
     * - bgIndex 若传入，将在本次批量中保持一致（0/1），不传则由服务端随机。
     */
    async uploadImageWithBackground(file: File, options?: { endpoint?: string; apiKey?: string; bgUrl?: string; bgIndex?: number; region?: { left: number; top: number; width: number; height: number } }): Promise<string> {
        const endpoint = options?.endpoint || (window as any).__IMAGE_UPLOAD_ENDPOINT__ || (useAppStore?.getState?.()?.config?.imageUploadEndpoint) || '/api/v1/upload'
        const apiKey = options?.apiKey || (window as any).__IMAGE_UPLOAD_API_KEY__ || (useAppStore?.getState?.()?.config?.imageUploadApiKey) || ''
        const dataUrl = await this.readFileAsDataURL(file)
        const payload: any = {
            filename: file.name,
            mime: file.type || 'image/png',
            data: dataUrl,
            endpoint,
            apiKey
        }
        if (options?.bgUrl) payload.bgUrl = options.bgUrl
        if (options?.bgIndex !== undefined) payload.bgIndex = options.bgIndex
        if (options?.region) payload.region = options.region

        const resp = await fetch('/api/image/upload-with-bg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        const result = await resp.json().catch(() => ({}))
        if (!resp.ok || !result?.success || !result?.data?.url) {
            const msg = result?.error || result?.message || `上传失败(${resp.status})`
            throw new Error(msg)
        }
        return result.data.url as string
    }

    /**
     * 直接将 DataURL/Base64 图片上传到图床。
     * 适用于模型生成的图片（无需先转 File）。
     */
    async uploadDataUrlToHosting(dataUrl: string, filename = 'generated.png', mime = 'image/png', endpointOverride?: string, apiKeyOverride?: string): Promise<string> {
        const endpoint = endpointOverride || (window as any).__IMAGE_UPLOAD_ENDPOINT__ || (useAppStore?.getState?.()?.config?.imageUploadEndpoint) || '/api/v1/upload'
        const apiKey = apiKeyOverride || (window as any).__IMAGE_UPLOAD_API_KEY__ || (useAppStore?.getState?.()?.config?.imageUploadApiKey) || ''
        const proxyResp = await fetch('/api/image/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, mime, data: dataUrl, endpoint, apiKey })
        })
        const result = await proxyResp.json().catch(() => ({}))
        if (!proxyResp.ok || !result?.success || !result?.data?.url) {
            const msg = result?.error || result?.message || `上传失败(${proxyResp.status})`
            throw new Error(msg)
        }
        return result.data.url as string
    }

    /**
     * 提取图像提示词
     */
    extractImagePrompts(content: string): string[] {
        // 使用详细提取实现，兼容老接口，返回纯字符串数组
        const detailed = this.extractImagePromptsDetailed(content)
        if (detailed.length > 0) return detailed.map(d => d.prompt)

        const prompts: string[] = []
        // 兜底：查找包含关键词的长文本段落（允许换行）
        const fallbackMatches = content.match(/(?:thumbnail|cover|image)[\s\S]{0,400}?(?:young\s+(?:man|woman)|beautiful|person)[\s\S]{50,}/gi)
        if (fallbackMatches) {
            fallbackMatches.forEach(match => {
                const trimmed = match.trim()
                if (trimmed.length > 50) prompts.push(trimmed)
            })
        }
        return prompts
    }

    /**
     * 提取图像提示词（带类型信息）
     * 返回包含类型标记的提示词，便于按 YouTube/Instagram 各生成一张图片
     */
    extractImagePromptsDetailed(content: string): Array<{ prompt: string; kind: 'youtube' | 'instagram' | 'other' }> {
        const results: Array<{ prompt: string; kind: 'youtube' | 'instagram' | 'other' }> = []

        // 抽取某个标题后的段落（支持多行），再从段落中优先取成对引号内的内容
        const extractSection = (titleRegex: RegExp): string | null => {
            const m = content.match(titleRegex)
            if (!m) return null
            const start = m.index! + m[0].length
            // 从标题后开始，直到下一个加粗标题或分隔线或文本结尾
            const rest = content.slice(start)
            const endMatch = rest.match(/\n\s*(?:\*\*[^*]+\*\*|---)\s*/)
            const section = endMatch ? rest.slice(0, endMatch.index) : rest
            // 优先取引号内内容（跨行）
            const quoted = section.match(/"([\s\S]+?)"|\'([\s\S]+?)\'/)
            if (quoted) {
                return (quoted[1] || quoted[2] || '').trim()
            }
            return section.trim()
        }

        // 仅取“封面 Prompt”区块作为提示词（单张图）
        const coverSec = extractSection(/\*\*\s*封面\s*Prompt\s*\*\*\s*:?/i)
        if (coverSec && coverSec.length > 10) results.push({ prompt: coverSec, kind: 'other' })

        // 备用：提取包含关键词的长段文本
        if (results.length === 0) {
            const fallbackMatches = content.match(/(?:thumbnail|cover|image)[\s\S]{0,400}?(?:young\s+(?:man|woman)|beautiful|person)[\s\S]{50,}/gi)
            if (fallbackMatches) {
                fallbackMatches.forEach(match => {
                    if (match.length > 50) {
                        results.push({ prompt: match.trim(), kind: 'other' })
                    }
                })
            }
        }

        return results
    }

    /**
     * 解析Markdown生成器响应
     */
    parseMarkdownResponse(rawResponse: string): { filename: string; content: string } {
        try {
            // 尝试解析JSON响应
            const parsed = JSON.parse(rawResponse)

            if (parsed.markdown && parsed.filename) {
                return {
                    filename: parsed.filename,
                    content: parsed.markdown
                }
            }
        } catch (jsonError) {
            // 尝试从响应中提取可能的JSON部分
            const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0])
                    if (parsed.markdown) {
                        return {
                            filename: parsed.filename || 'explanation.md',
                            content: parsed.markdown
                        }
                    }
                } catch (partialJsonError) {
                    // 忽略解析错误，使用原始内容
                }
            }
        }

        // 如果无法解析JSON，直接使用原始内容
        return {
            filename: 'explanation.md',
            content: rawResponse
        }
    }
}

// 列出当前 API Key 在 baseUrl 下可用的模型列表
export async function listModels(apiConfig: APIConfig): Promise<AIModel[]> {
    const url = `${apiConfig.baseUrl.replace(/\/$/, '')}/models`
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiConfig.apiKey}`,
            'Content-Type': 'application/json'
        }
    })
    const ct = res.headers.get('content-type') || ''
    const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text().catch(() => '')
    if (!res.ok) {
        const msg = typeof body === 'string' ? body : JSON.stringify(body)
        throw new Error(`模型列表获取失败(${res.status}): ${msg}`)
    }

    // 兼容多种返回结构
    const rawList = Array.isArray(body)
        ? body
        : Array.isArray((body as any)?.data)
            ? (body as any).data
            : []

    const models: AIModel[] = rawList
        .map((m: any) => {
            const id = m.id || m.model || m.name
            if (!id) return null
            return {
                id: String(id),
                name: String(id),
                description: m.description || m.owned_by || 'Discovered via API',
                provider: (m.provider || m.owner || '').toString() || undefined
            } as AIModel
        })
        .filter(Boolean) as AIModel[]

    // 去重
    const seen = new Set<string>()
    const deduped = models.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    return deduped
}
