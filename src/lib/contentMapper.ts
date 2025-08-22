export interface ContentRecordPayload {
    Title: string
    Description: string
    Category: string
    Type: 'workflow' | 'prompt'
    Usage_Guide: string
    like: number
    status: string
    Title_CN: string
    Description_CN: string
    Usage_Guide_CN: string
    // 可选图片字段：由前端上传图床后写入
    Cover?: string[]
    Example_Output?: string[]
    // 新增：站点后缀 Slug（短、连续英文字符串）
    Slug?: string
}

function sanitizeSlug(input: string): string {
    if (!input) return ''
    let s = String(input).toLowerCase().trim()
    s = s.replace(/["'`“”‘’]/g, '')
    s = s.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    s = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
    return s
}

function stripBrackets(input: string): string {
    if (!input) return ''
    let s = input
    // () and （）
    s = s.replace(/[\(（][^\)）]*[\)）]/g, '')
    // [] and 【】
    s = s.replace(/[\[][^\]]*[\]]/g, '')
    s = s.replace(/【[^】]*】/g, '')
    // <>
    s = s.replace(/<[^>]*>/g, '')
    return s.replace(/[\s\t]+$/g, '').trim()
}

// 移除双引号（包含英文 " 与中文 “ ”）
function removeDoubleQuotes(input: string): string {
    if (!input) return ''
    return input.replace(/["“”]/g, '')
}

function extractAfterBoldHeader(markdown: string, header: string): string {
    const re = new RegExp(`\\*\\*\\s*${header}\\s*\\*\\*\\s*\n([\\s\\S]*?)(?=\n\\*\\*|$)`, 'i')
    const m = markdown.match(re)
    return m ? m[1].trim() : ''
}

function extractH1(markdown: string): string {
    const m = markdown.match(/^#\s+(.+)$/m)
    return m ? m[1].trim() : ''
}

// 生成精简版的 slug：使用短横线连接，保留完整词汇不缩写
function slugifyShort(input: string, maxLength = 50): string {
    if (!input) return ''

    // 标准化并去掉音标
    const normalized = input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')

    // 转为小写，分词：按非字母数字分隔
    const tokens = normalized
        .toLowerCase()
        .split(/[^a-zA-Z0-9\u4e00-\u9fff]+/)
        .filter(Boolean)
        .filter(token => token.length > 0)

    if (tokens.length === 0) return ''

    // 过滤掉常见的无意义词汇
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']
    const meaningfulTokens = tokens.filter(token => !stopWords.includes(token))

    // 如果过滤后没有词汇，则使用原始tokens
    const finalTokens = meaningfulTokens.length > 0 ? meaningfulTokens : tokens

    // 截取前几个词，确保总长度不超过maxLength
    const segments: string[] = []
    let currentLength = 0

    for (const token of finalTokens) {
        const tokenWithHyphen = segments.length > 0 ? token.length + 1 : token.length // +1 for hyphen
        if (currentLength + tokenWithHyphen > maxLength) break

        segments.push(token)
        currentLength += tokenWithHyphen
    }

    const result = segments.join('-')
    if (!result) {
        // 回退：使用随机字符串
        return 'ai-' + Math.random().toString(36).slice(2, 8)
    }

    return result
}

export function mapContentToRecord(markdown: string, defaults?: Partial<ContentRecordPayload>): ContentRecordPayload {
    // 中文注释：为更稳健的类型识别，先提供原始分段内容供启发式判断
    const rawType = extractAfterBoldHeader(markdown, 'Type')
    const rawUsage = extractAfterBoldHeader(markdown, 'How to Use')
    const rawSlug = extractAfterBoldHeader(markdown, 'Slug')
    // Title: 优先 **标题**，否则 H1
    let title = extractAfterBoldHeader(markdown, '标题') || extractH1(markdown)
    // Description: 兼容 **TLDR** 与 **TL;DR**
    let description = extractAfterBoldHeader(markdown, 'TLDR')
        || extractAfterBoldHeader(markdown, 'TL;DR')
    // Usage Guide: **How to Use** 段（增加常见别名兜底，确保入库到 Usage_Guide）
    let usage =
        extractAfterBoldHeader(markdown, 'How to Use')
        || extractAfterBoldHeader(markdown, 'Usage Guide')
        || extractAfterBoldHeader(markdown, 'How do you use this prompt?')
    // 中文三项：优先读取新增的中文分节
    let titleCN = extractAfterBoldHeader(markdown, '标题（中文）') || extractAfterBoldHeader(markdown, '标题')
    let descCN = extractAfterBoldHeader(markdown, 'TLDR（中文）')
        || extractAfterBoldHeader(markdown, 'TL;DR（中文）')
        || extractAfterBoldHeader(markdown, 'TLDR')
    let usageCN =
        extractAfterBoldHeader(markdown, 'How to Use（中文）')
        || extractAfterBoldHeader(markdown, 'Usage Guide（中文）')
        || extractAfterBoldHeader(markdown, '如何使用')
        || extractAfterBoldHeader(markdown, 'How to Use')

    // 清理括号内容并移除双引号
    title = removeDoubleQuotes(stripBrackets(title))
    description = removeDoubleQuotes(stripBrackets(description))
    usage = removeDoubleQuotes(stripBrackets(usage))
    titleCN = removeDoubleQuotes(stripBrackets(titleCN))
    descCN = removeDoubleQuotes(stripBrackets(descCN))
    usageCN = removeDoubleQuotes(stripBrackets(usageCN))

    // 生成短 Slug（优先使用 AI 提供的 Slug；否则回退到基于标题的自动生成 ≤20 字符）
    const aiSlugCandidate = sanitizeSlug(removeDoubleQuotes(stripBrackets(rawSlug)))
    let slug = aiSlugCandidate || slugifyShort(title, 20)
    if (!slug) slug = `ai-${Math.random().toString(36).slice(2, 8)}`

    // 中文注释：基础类型解析（保持原有严格等式判定）
    const parsedType = (removeDoubleQuotes(stripBrackets(rawType)).toLowerCase() as any) === 'prompt' ? 'prompt' : 'workflow'

    // 中文注释：启发式兜底——若 AI 判为 workflow，但从使用说明看更像单条可复制的 Prompt，则改判为 prompt
    const looksLikePromptDoc = (() => {
        const text = (rawUsage || '').toLowerCase()
        const hasCopy = /copy\s+prompt|copy\s+the\s+prompt/.test(text)
        const hasPasteChatgpt = /paste[\s\S]{0,40}chatgpt/.test(text)
        const hasConnect = /\bconnect\b\s+(gmail|notion|google|github|sheets|calendar|drive|zapier|slack|airtable)/i.test(text)
        const stepMatches = (rawUsage.match(/^\s*\d+\./gm) || [])
        const stepsCount = stepMatches.length
        const hasInputPromptSection = /Input Your Story Prompt|Copy \& Paste|Copy & Paste/i.test(markdown)
        // 经验法则：满足 复制+粘贴 到 ChatGPT、且无外部连接，且步骤不多（≤4），或明确存在“Input Your Story Prompt”段
        if (((hasCopy && hasPasteChatgpt && !hasConnect) && stepsCount <= 4) || hasInputPromptSection) {
            return true
        }
        return false
    })()

    const finalType: 'workflow' | 'prompt' = parsedType === 'workflow' && looksLikePromptDoc ? 'prompt' : parsedType

    const payload: ContentRecordPayload = {
        // 先展开 defaults，让 extracted 字段优先级更高
        ...(defaults || {}),
        Title: title || 'Untitled', // 确保标题不为空
        Description: description,
        Category: removeDoubleQuotes(stripBrackets(extractAfterBoldHeader(markdown, 'Category'))) || '',
        Type: finalType,
        Usage_Guide: usage,
        like: Math.floor(Math.random() * 100),
        status: 'draft',
        Title_CN: titleCN,
        Description_CN: descCN,
        Usage_Guide_CN: usageCN,
        Slug: slug
    }

    return payload
}


