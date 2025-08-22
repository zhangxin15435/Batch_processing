export async function createLarkRecord(record: Record<string, any>): Promise<any> {
    const res = await fetch('/api/lark/bitable/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record })
    })
    const ct = res.headers.get('content-type') || ''
    const payload = ct.includes('application/json') ? await res.json() : { error: await res.text() }
    if (!res.ok || payload?.error) throw new Error(payload?.error || '创建多维表格记录失败')
    return payload
}

export async function uploadTextAsLarkFile(filename: string, content: string, mime = 'text/markdown'): Promise<string> {
    const res = await fetch('/api/lark/drive/upload_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content, mime })
    })
    const ct = res.headers.get('content-type') || ''
    const payload = ct.includes('application/json') ? await res.json() : { error: await res.text() }
    if (!res.ok || payload?.error) throw new Error(payload?.error || '飞书附件上传失败')
    return payload.file_token as string
}


