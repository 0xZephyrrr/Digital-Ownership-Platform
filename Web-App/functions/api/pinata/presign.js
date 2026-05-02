import { PinataSDK } from 'pinata'

const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024
const DEFAULT_EXPIRY_SECONDS = 60

function json(value, init = {}) {
  const headers = new Headers(init.headers || {})
  headers.set('Content-Type', 'application/json')
  headers.set('Cache-Control', 'no-store')

  return new Response(JSON.stringify(value), {
    ...init,
    headers,
  })
}

function normalizeAllowedOrigins(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
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

function resolveContentNetwork(value) {
  return String(value || '').trim().toLowerCase() === 'private' ? 'private' : 'public'
}

function resolveUploadNetwork(kind, contentNetwork) {
  if (kind === 'content') {
    return resolveContentNetwork(contentNetwork)
  }

  return 'public'
}

function createPinataClient(pinataJwt) {
  return new PinataSDK({
    pinataJwt,
  })
}

async function createSignedUploadUrl(pinata, { network, date, expires, fileName, maxFileSize, mimeTypes, keyvalues }) {
  const uploader = network === 'private' ? pinata.upload.private : pinata.upload.public

  return uploader.createSignedURL({
    date,
    expires,
    name: fileName,
    maxFileSize,
    ...(mimeTypes.length > 0 ? { mimeTypes } : {}),
    keyvalues,
  })
}

export async function onRequestPost(context) {
  const { request, env } = context

  if (!env.PINATA_JWT) {
    return json(
      {
        error: 'Missing server-side PINATA_JWT. Configure it in Cloudflare Pages Variables and Secrets.',
      },
      { status: 500 },
    )
  }

  const allowedOrigins = normalizeAllowedOrigins(env.UPLOAD_ALLOWED_ORIGINS)
  const requestOrigin = String(request.headers.get('Origin') || '')

  if (allowedOrigins.length > 0 && requestOrigin && !allowedOrigins.includes(requestOrigin)) {
    return json({ error: 'Origin not allowed for upload signing.' }, { status: 403 })
  }

  let body

  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const fileName = sanitizeFileName(body.fileName)
  const contentType = String(body.contentType || '').trim()
  const kind = String(body.kind || 'content').trim()
  const size = Number(body.size || 0)
  const maxFileBytes = Number(env.PINATA_MAX_FILE_BYTES || DEFAULT_MAX_FILE_BYTES)
  const expirySeconds = Number(env.PINATA_PRESIGN_TTL || DEFAULT_EXPIRY_SECONDS)
  const signedAt = Math.floor(Date.now() / 1000)
  const network = resolveUploadNetwork(kind, env.PINATA_CONTENT_NETWORK)

  if (!Number.isFinite(size) || size <= 0) {
    return json({ error: 'Invalid upload size.' }, { status: 400 })
  }

  if (size > maxFileBytes) {
    return json(
      {
        error: `File exceeds ${Math.round(maxFileBytes / (1024 * 1024))} MB upload limit.`,
      },
      { status: 400 },
    )
  }

  if (!isAllowedMimeType(contentType)) {
    return json({ error: `Unsupported content type: ${contentType}` }, { status: 400 })
  }

  try {
    const pinata = createPinataClient(env.PINATA_JWT)
    const signedUrl = await createSignedUploadUrl(pinata, {
      network,
      date: signedAt,
      expires: expirySeconds,
      fileName,
      maxFileSize: size,
      mimeTypes: contentType ? [contentType] : [],
      keyvalues: {
        app: 'content-certificate-market',
        kind,
        network,
      },
    })

    return json({ url: signedUrl, network })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown signing error.'
    return json({ error: `Pinata signing failed: ${message}` }, { status: 502 })
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Cache-Control': 'no-store',
    },
  })
}
