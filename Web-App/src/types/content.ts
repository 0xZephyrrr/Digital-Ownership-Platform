import type { Address, Hex } from 'viem'

export const contentTypeOptions = [
  'Novel',
  'Image',
  'Music',
  'Video',
  'Other',
] as const

export type AssetMetadata = {
  name?: string
  description?: string
  image?: string
  external_url?: string
  attributes?: Array<{
    trait_type: string
    value: string | number
  }>
  assetType?: string
  creator?: string
  previewURI?: string
  encryptedContentURI?: string
  mimeType?: string
  size?: number
  contentHash?: string
  encryptionScheme?: string
  originalFileName?: string
  accessModel?: string
  license?: string
  createdAt?: string
}

export type ContractContentMetadata = {
  creator: Address
  contentType: number
  mintedAt: bigint
  metadataURI: string
  encryptedContentURI: string
  previewURI: string
  contentHash: Hex
}

export type Listing = {
  seller: Address
  price: bigint
  isActive: boolean
}

export type AssetRecord = {
  tokenId: bigint
  owner: Address
  tokenURI: string
  metadata: AssetMetadata | null
  contractMetadata: ContractContentMetadata
  listing: Listing
}

export type SaleHistoryRecord = {
  tokenId: bigint
  seller: Address
  buyer: Address
  price: bigint
  royaltyAmount: bigint
  platformFeeAmount: bigint
  txHash: Hex
  blockNumber: bigint
  timestamp: bigint
}
