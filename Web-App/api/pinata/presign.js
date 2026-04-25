const PINATA_SIGN_URL = 'https://uploads.pinata.cloud/v3/files/sign'
const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024
const DEFAULT_EXPIRY_SECONDS = 60

function normalizeAllowedOrigins() {
  return String(process.env.UPLOAD_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function sanitizeFileName(fileName) {
  const trimmed = String(fileName || 'upload.bin').trim() || 'upload.bin'
  return trimmed.replace(/[^a-zA-Z0-9._() -]/g, '_').slice(0, 120)
}

function isAllowedMimeType(contentType) {
  if (!contentType) return true

  return (
    contentType.startsWith('image/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('text/') ||
    [
      'application/json',
      'application/pdf',
      'application/octet-stream',
      'application/epub+zip',
      'application/zip',
    ].includes(contentType)
  )
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  if (!process.env.PINATA_JWT) {
    return response.status(500).json({
      error: 'Missing server-side PINATA_JWT. Configure it in Vercel project settings.',
    })
  }

  const allowedOrigins = normalizeAllowedOrigins()
  const requestOrigin = String(request.headers.origin || '')

  if (allowedOrigins.length > 0 && requestOrigin && !allowedOrigins.includes(requestOrigin)) {
    return response.status(403).json({ error: 'Origin not allowed for upload signing.' })
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {}
  const fileName = sanitizeFileName(body.fileName)
  const contentType = String(body.contentType || '').trim()
  const kind = String(body.kind || 'content').trim()
  const size = Number(body.size || 0)
  const maxFileBytes = Number(process.env.PINATA_MAX_FILE_BYTES || DEFAULT_MAX_FILE_BYTES)
  const expirySeconds = Number(process.env.PINATA_PRESIGN_TTL || DEFAULT_EXPIRY_SECONDS)

  if (!Number.isFinite(size) || size <= 0) {
    return response.status(400).json({ error: 'Invalid upload size.' })
  }

  if (size > maxFileBytes) {
    return response.status(400).json({
      error: `File exceeds ${Math.round(maxFileBytes / (1024 * 1024))} MB upload limit.`,
    })
  }

  if (!isAllowedMimeType(contentType)) {
    return response.status(400).json({ error: `Unsupported content type: ${contentType}` })
  }

  const upstreamResponse = await fetch(PINATA_SIGN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PINATA_JWT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expires: expirySeconds,
      name: fileName,
      maxFileSize: size,
      ...(contentType ? { mimeTypes: [contentType] } : {}),
      keyvalues: {
        app: 'content-certificate-market',
        kind,
      },
    }),
  })

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text()
    return response.status(upstreamResponse.status).json({
      error: `Pinata signing failed: ${upstreamResponse.status} ${upstreamResponse.statusText} - ${errorText}`,
    })
  }

  const payload = await upstreamResponse.json()
  const signedUrl = payload?.data || payload?.url

  if (!signedUrl) {
    return response.status(502).json({ error: 'Pinata did not return a signed upload URL.' })
  }

  return response.status(200).json({ url: signedUrl })
}
