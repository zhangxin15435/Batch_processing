export async function saveContentRecord(record: Record<string, any>): Promise<void> {
    const res = await fetch('/api/content/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
    })
    const ct = res.headers.get('content-type') || ''
    const payload = ct.includes('application/json') ? await res.json().catch(() => ({})) : { error: await res.text().catch(() => '非JSON响应') }
    if (!res.ok || payload?.error) {
        throw new Error(payload?.error || '保存失败')
    }
}

export async function listContent(limit = 100): Promise<any[]> {
    const res = await fetch(`/api/content/list?limit=${encodeURIComponent(String(limit))}`)
    const ct = res.headers.get('content-type') || ''
    const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : { error: await res.text().catch(() => '非JSON响应') }
    if (!res.ok || data?.error) {
        throw new Error(data?.error || '读取失败')
    }
    return Array.isArray((data as any).items) ? (data as any).items : []
}

export async function getContentByKey(params: { recordId?: string; title?: string; slug?: string }): Promise<any | null> {
    const qs = new URLSearchParams()
    if (params.recordId) qs.append('recordId', String(params.recordId))
    if (params.title) qs.append('title', String(params.title))
    if (params.slug) qs.append('slug', String(params.slug))
    const res = await fetch(`/api/content/one?${qs.toString()}`)
    const ct = res.headers.get('content-type') || ''
    const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : { error: await res.text().catch(() => '非JSON响应') }
    if (!res.ok || (data as any)?.error) return null
    return (data as any).item || null
}


