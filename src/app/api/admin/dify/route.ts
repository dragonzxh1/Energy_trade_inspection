import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { isAdminAuthorized } from '@/lib/server/admin-auth'

export const runtime = 'nodejs'

const DIFY_BASE = process.env.DIFY_BASE_URL ?? 'http://212.64.20.114'
const DIFY_KEY_A = process.env.DIFY_WORKFLOW_API_KEY ?? 'app-of1Cd6t1rGtpSqgaLt7SboTp'
const DIFY_KEY_B = process.env.DIFY_WORKFLOW_API_KEY_QUOTES ?? 'app-KOYWmxcVituHTzCGj4f5Obw4'

export async function POST(req: NextRequest) {
  const session = await auth()
  const result = isAdminAuthorized(req, session?.user?.email ?? null)
  if (!result.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { file?: File; workflow?: string }
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const workflow = formData.get('workflow') as string | null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!workflow) return NextResponse.json({ error: 'No workflow selected' }, { status: 400 })

    const apiKey = workflow === 'B' ? DIFY_KEY_B : DIFY_KEY_A

    // Step 1: Upload file to Dify
    const uploadForm = new FormData()
    uploadForm.append('file', file)
    uploadForm.append('user', session?.user?.email ?? 'admin-upload')

    const uploadRes = await fetch(`${DIFY_BASE}/v1/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: uploadForm,
    })

    if (!uploadRes.ok) {
      const err = await uploadRes.text()
      return NextResponse.json({ error: `Dify upload failed: ${err}` }, { status: 502 })
    }

    const { id: fileId } = await uploadRes.json()

    // Step 2: Build workflow inputs
    const fileInput = {
      transfer_method: 'local_file',
      upload_file_id: fileId,
      type: file.type.startsWith('image/') ? 'image' : 'document',
    }

    const inputs: Record<string, unknown> = {
      source_file: fileInput,
      source_channel: 'admin_manual_upload',
      source_message_id: `upload_${Date.now()}`,
      file_name: file.name,
      message_timestamp: new Date().toISOString(),
      caption: `Manual upload: ${file.name}`,
      content_type: file.type.startsWith('image/') ? 'image' : 'document',
    }

    // For Workflow B, run OCR first
    if (workflow === 'B' && file.type.startsWith('image/')) {
      const ocrText = await runTableOcr(file)
      if (ocrText) {
        inputs.ocr_text = ocrText
      }
    }

    // Step 3: Run Dify workflow
    const wfRes = await fetch(`${DIFY_BASE}/v1/workflows/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs,
        response_mode: 'blocking',
        user: session?.user?.email ?? 'admin-upload',
      }),
    })

    const wfData = await wfRes.json()

    if (!wfRes.ok || wfData.data?.status === 'failed') {
      return NextResponse.json({
        error: wfData.data?.error ?? 'Workflow failed',
        workflow_run_id: wfData.data?.id,
      }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      workflow: workflow === 'B' ? 'Quotes OCR' : 'Document Analyzer',
      file_id: fileId,
      workflow_run_id: wfData.data?.id,
      elapsed: wfData.data?.elapsed_time,
      tokens: wfData.data?.total_tokens,
      outputs: wfData.data?.outputs,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function runTableOcr(file: File): Promise<string> {
  const tcId = process.env.TENCENT_SECRET_ID
  const tcKey = process.env.TENCENT_SECRET_KEY
  if (!tcId || !tcKey) return ''

  const crypto = await import('crypto')
  const arrayBuffer = await file.arrayBuffer()
  const imgB64 = Buffer.from(arrayBuffer).toString('base64')

  const payload = JSON.stringify({ ImageBase64: imgB64 })
  const now = new Date()
  const ts = Math.floor(now.getTime() / 1000).toString()
  const ds = now.toISOString().substring(0, 10)

  function sha256H(m: string) { return crypto.createHash('sha256').update(m, 'utf-8').digest('hex') }
  function hmacS(k: Buffer | string, m: string) { return crypto.createHmac('sha256', k).update(m, 'utf-8').digest() }

  const ch = `content-type:application/json\nhost:ocr.tencentcloudapi.com\nx-tc-action:recognizetableaccurateocr\n`
  const hp = sha256H(payload)
  const cr = `POST\n/\n\n${ch}\ncontent-type;host;x-tc-action\n${hp}`
  const cs = `${ds}/ocr/tc3_request`
  const sts = `TC3-HMAC-SHA256\n${ts}\n${cs}\n${sha256H(cr)}`

  const sd = hmacS(`TC3${tcKey}`, ds)
  const ss = hmacS(sd, 'ocr')
  const sg = hmacS(ss, 'tc3_request')
  const sig = hmacS(sg, sts).toString('hex')
  const auth = `TC3-HMAC-SHA256 Credential=${tcId}/${cs}, SignedHeaders=content-type;host;x-tc-action, Signature=${sig}`

  const resp = await fetch('https://ocr.tencentcloudapi.com/', {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      Host: 'ocr.tencentcloudapi.com',
      'X-TC-Action': 'RecognizeTableAccurateOCR',
      'X-TC-Timestamp': ts,
      'X-TC-Version': '2018-11-19',
      'X-TC-Region': 'ap-guangzhou',
    },
    body: payload,
  })

  const data = await resp.json()
  const tables = data.Response?.TableDetections ?? []
  const lines: string[] = []
  for (let t = 0; t < tables.length; t++) {
    for (const c of tables[t].Cells ?? []) {
      const txt = (c.Text ?? '').trim()
      if (txt) lines.push(`[T${t}R${c.RowTl}C${c.ColTl}] ${txt}`)
    }
  }
  return lines.join('\n')
}
