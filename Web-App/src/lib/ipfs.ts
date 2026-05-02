export type PinataCredentials = {
  pinataJWT?: string
  pinataKey?: string
  pinataSecret?: string
}

export type IPFSUploadResult = {
  cid: string
  url: string
  ipfsUri: string
}

const PINATA_FILE_URL = 'https://uploads.pinata.cloud/v3/files'
const DEFAULT_GATEWAY_BASE = 'https://gateway.pinata.cloud/ipfs'
const PRESIGN_ENDPOINT = import.meta.env.VITE_PINATA_PRESIGN_ENDPOINT || '/api/pinata/presign'

type UploadKind = 'content' | 'preview' | 'metadata'
type UploadNetwork = 'public' | 'private'

type PresignRequestPayload = {
  fileName: string
  contentType: string
  size: number
  kind: UploadKind
}

type PresignResponsePayload = {
  url?: string
}

type UploadApiResponse =
  | {
      IpfsHash?: string
    }
  | {
      cid?: string
      data?: {
        cid?: string
      }
    }

function buildPinataHeaders(credentials: PinataCredentials) {
  const headers: Record<string, string> = {}

  if (credentials.pinataJWT) {
    headers.Authorization = `Bearer ${credentials.pinataJWT}`
    return headers
  }

  if (credentials.pinataKey && credentials.pinataSecret) {
    headers.pinata_api_key = credentials.pinataKey
    headers.pinata_secret_api_key = credentials.pinataSecret
    return headers
  }

  throw new Error('Missing Pinata credentials. Configure VITE_PINATA_JWT or VITE_PINATA_KEY/VITE_PINATA_SECRET.')
}

export function getPinataCredentialsFromEnv(): PinataCredentials {
  const jwt = import.meta.env.VITE_PINATA_JWT
  const key = import.meta.env.VITE_PINATA_KEY
  const secret = import.meta.env.VITE_PINATA_SECRET

  return {
    ...(jwt ? { pinataJWT: jwt } : {}),
    ...(key ? { pinataKey: key } : {}),
    ...(secret ? { pinataSecret: secret } : {}),
  }
}

export function hasPinataCredentials(credentials: PinataCredentials) {
  return Boolean(credentials.pinataJWT || (credentials.pinataKey && credentials.pinataSecret))
}

function resolveGatewayBase() {
  const configured = import.meta.env.VITE_IPFS_GATEWAY_BASE || DEFAULT_GATEWAY_BASE
  return configured.endsWith('/') ? configured.slice(0, -1) : configured
}

function parseUploadResponse(payload: UploadApiResponse): IPFSUploadResult {
  const normalizedPayload = payload as {
    IpfsHash?: string
    cid?: string
    data?: {
      cid?: string
    }
  }
  const cid = normalizedPayload.IpfsHash || normalizedPayload.cid || normalizedPayload.data?.cid

  if (!cid) {
    throw new Error('Pinata upload succeeded but no CID was returned.')
  }

  const gatewayBase = resolveGatewayBase()

  return {
    cid,
    url: `${gatewayBase}/${cid}`,
    ipfsUri: `ipfs://${cid}`,
  }
}

function normalizeUploadNetwork(value: string | undefined): UploadNetwork {
  return String(value || '').trim().toLowerCase() === 'private' ? 'private' : 'public'
}

function resolveUploadNetwork(kind: UploadKind): UploadNetwork {
  if (kind !== 'content') return 'public'
  return normalizeUploadNetwork(import.meta.env.VITE_PINATA_CONTENT_NETWORK)
}

async function requestPresignedUploadUrl(payload: PresignRequestPayload) {
  let response: Response

  try {
    response = await fetch(PRESIGN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new Error(
      'Pinata signing endpoint is unavailable. For local Vite development, configure VITE_PINATA_JWT. For Vercel or Cloudflare Pages, deploy the /api signer and set PINATA_JWT.',
      { cause: error },
    )
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Pinata signing endpoint failed: ${response.status} ${response.statusText} - ${errorText}`)
  }

  const body = (await response.json()) as PresignResponsePayload
  if (!body.url) {
    throw new Error('Pinata signing endpoint did not return a signed upload URL.')
  }

  return body.url
}

export async function uploadFileToPinata(
  file: File,
  credentials: PinataCredentials,
  kind: UploadKind = 'content',
): Promise<IPFSUploadResult> {
  const useDirectClientCredentials = hasPinataCredentials(credentials)
  const headers = useDirectClientCredentials ? buildPinataHeaders(credentials) : {}
  const formData = new FormData()
  formData.append('file', file)

  if (useDirectClientCredentials) {
    formData.append('network', resolveUploadNetwork(kind))
  }

  const uploadEndpoint = useDirectClientCredentials
    ? PINATA_FILE_URL
    : await requestPresignedUploadUrl({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        kind,
      })

  const response = await fetch(uploadEndpoint, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Pinata upload failed: ${response.status} ${response.statusText} - ${errorText}`)
  }

  const payload = (await response.json()) as UploadApiResponse
  return parseUploadResponse(payload)
}

export async function uploadJsonToPinata(
  value: object,
  credentials: PinataCredentials,
  fileName = 'metadata.json',
): Promise<IPFSUploadResult> {
  const jsonFile = new File([JSON.stringify(value, null, 2)], fileName, {
    type: 'application/json',
  })

  return uploadFileToPinata(jsonFile, credentials, 'metadata')
}

export function resolveIpfsUri(uri: string) {
  if (!uri) return ''
  if (uri.startsWith('ipfs://')) {
    return `${resolveGatewayBase()}/${uri.slice('ipfs://'.length)}`
  }
  return uri
}

export async function fetchJsonFromUri<T>(uri: string): Promise<T | null> {
  if (!uri) return null

  const response = await fetch(resolveIpfsUri(uri))
  if (!response.ok) {
    throw new Error(`Failed to fetch JSON metadata: ${response.status}`)
  }

  return (await response.json()) as T
}
