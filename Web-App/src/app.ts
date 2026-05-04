import { parseEther, type Address } from 'viem'
import {
  CONTRACT_ABI,
  buildExplorerTxUrl,
  fetchListedAssets,
  fetchOwnedAssets,
  fetchSaleHistory,
  findRegisteredTokenIdByContentHash,
  getMintedTokenId,
  readRequiredContractAddress,
  toContentTypeIndex,
  toRoyaltyBps,
} from './lib/contract'
import { decryptFileFromUrl, encryptFile } from './lib/crypto'
import { formatBytes, formatEth, formatTimestamp, getContentTypeLabel, shortenAddress } from './lib/format'
import {
  getPinataCredentialsFromEnv,
  resolveIpfsUri,
  resolveIpfsUriCandidates,
  uploadFileToPinata,
  uploadJsonToPinata,
} from './lib/ipfs'
import { buildCertificateImageDataUri } from './lib/metadata'
import {
  attachWalletListeners,
  connectInjectedWallet,
  createConfiguredPublicClient,
  getConfiguredChain,
  hasInjectedWallet,
  hydrateInjectedWallet,
  type WalletConnection,
} from './lib/wallet'
import type { AssetRecord, SaleHistoryRecord } from './types/content'
import { contentTypeOptions } from './types/content'

type ViewName = 'marketplace' | 'publish' | 'library' | 'history'

type PublishResult = {
  tokenId: string
  metadataURI: string
  encryptedContentURI: string
  accessKey: string
  txHash: string
  explorerUrl: string
}

type Notice = {
  tone: 'info' | 'success' | 'error'
  message: string
}

type AppState = {
  view: ViewName
  account: Address | null
  wallet: WalletConnection | null
  listedAssets: AssetRecord[]
  ownedAssets: AssetRecord[]
  saleHistory: SaleHistoryRecord[]
  accessKeys: Record<string, string>
  publishResult: PublishResult | null
  notice: Notice | null
  busyMessage: string | null
}

const rootElement = document.querySelector<HTMLDivElement>('#app')

if (!rootElement) {
  throw new Error('Missing #app root element')
}

const root = rootElement

const state: AppState = {
  view: 'marketplace',
  account: null,
  wallet: null,
  listedAssets: [],
  ownedAssets: [],
  saleHistory: [],
  accessKeys: {},
  publishResult: null,
  notice: null,
  busyMessage: null,
}

const publicClient = createConfiguredPublicClient()
const configuredChain = getConfiguredChain()
let detachWalletListeners = () => {}

function setNotice(tone: Notice['tone'], message: string) {
  state.notice = { tone, message }
  render()
}

function clearNotice() {
  state.notice = null
}

function setBusy(message: string | null) {
  state.busyMessage = message
  render()
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getConfiguredContractLabel() {
  try {
    return readRequiredContractAddress()
  } catch {
    return 'Not configured'
  }
}

function getAssetImageUris(asset: AssetRecord) {
  const imageUri = asset.metadata?.image || asset.metadata?.previewURI || asset.contractMetadata.previewURI || ''
  return resolveIpfsUriCandidates(imageUri)
}

function renderAssetImage(asset: AssetRecord, title: string) {
  const images = getAssetImageUris(asset)

  if (!images.length) {
    return '<div class="card__image card__image--empty">No preview</div>'
  }

  return `<img class="card__image" src="${escapeHtml(images[0])}" alt="${escapeHtml(
    title,
  )}" data-ipfs-srcs="${escapeHtml(JSON.stringify(images))}" data-ipfs-index="0" loading="lazy" decoding="async" />`
}

function renderNotice() {
  if (!state.notice) return ''
  return `<div class="notice notice--${state.notice.tone}">${escapeHtml(state.notice.message)}</div>`
}

function renderAssetMeta(asset: AssetRecord) {
  return `
    <div class="meta-row"><span>Owner</span><strong>${escapeHtml(shortenAddress(asset.owner))}</strong></div>
    <div class="meta-row"><span>Type</span><strong>${escapeHtml(
      getContentTypeLabel(asset.contractMetadata.contentType)
    )}</strong></div>
    <div class="meta-row"><span>Minted</span><strong>${escapeHtml(
      formatTimestamp(asset.contractMetadata.mintedAt)
    )}</strong></div>
  `
}

function renderMarketplaceCards() {
  if (!state.listedAssets.length) {
    return '<div class="empty-state">No live listings yet. Publish the first certificate to seed the marketplace.</div>'
  }

  return state.listedAssets
    .map((asset) => {
      const title = asset.metadata?.name || `Certificate #${asset.tokenId.toString()}`
      const description = asset.metadata?.description || 'No description provided.'
      const isSeller = state.account?.toLowerCase() === asset.listing.seller.toLowerCase()

      return `
        <article class="card">
          ${renderAssetImage(asset, title)}
          <div class="card__body">
            <div class="card__topline">
              <span class="pill">Token #${asset.tokenId.toString()}</span>
              <span class="pill pill--accent">${escapeHtml(formatEth(asset.listing.price))}</span>
            </div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(description)}</p>
            ${renderAssetMeta(asset)}
            <div class="card__actions">
              ${
                isSeller
                  ? `<button class="button button--secondary" data-action="cancel-listing" data-token-id="${asset.tokenId.toString()}">Cancel Listing</button>`
                  : `<button class="button" data-action="buy" data-token-id="${asset.tokenId.toString()}" data-price="${asset.listing.price.toString()}">Buy Certificate</button>`
              }
            </div>
          </div>
        </article>
      `
    })
    .join('')
}

function renderLibraryCards() {
  if (!state.account) {
    return '<div class="empty-state">Connect a wallet to see the certificates you currently own.</div>'
  }

  if (!state.ownedAssets.length) {
    return '<div class="empty-state">This wallet does not own any certificates on the configured chain yet.</div>'
  }

  return state.ownedAssets
    .map((asset) => {
      const tokenId = asset.tokenId.toString()
      const keyValue = state.accessKeys[tokenId] || ''
      const title = asset.metadata?.name || `Certificate #${tokenId}`
      const encryptedUri = asset.contractMetadata.encryptedContentURI

      return `
        <article class="card card--library">
          ${renderAssetImage(asset, title)}
          <div class="card__body">
            <div class="card__topline">
              <span class="pill">Token #${tokenId}</span>
              <span class="pill">${escapeHtml(formatBytes(asset.metadata?.size))}</span>
            </div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(asset.metadata?.description || 'Encrypted source available through IPFS download.')}</p>
            ${renderAssetMeta(asset)}
            <div class="field">
              <label for="access-key-${tokenId}">Access Key Package</label>
              <textarea
                id="access-key-${tokenId}"
                class="textarea textarea--compact"
                data-access-key-input="${tokenId}"
                placeholder="Paste the AES-GCM access key bundle for this asset."
              >${escapeHtml(keyValue)}</textarea>
            </div>
            <div class="card__actions">
              <button class="button button--secondary" data-action="download-encrypted" data-uri="${escapeHtml(
                encryptedUri
              )}">Download Encrypted File</button>
              <button class="button" data-action="decrypt-asset" data-token-id="${tokenId}" data-uri="${escapeHtml(
                encryptedUri
              )}">Decrypt and Save</button>
            </div>
          </div>
        </article>
      `
    })
    .join('')
}

function renderHistoryList(entries: SaleHistoryRecord[], emptyMessage: string) {
  if (!entries.length) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`
  }

  return `
    <div class="history-list">
      ${entries
        .map((entry) => {
          const txUrl = buildExplorerTxUrl(entry.txHash)

          return `
            <article class="history-card">
              <div class="card__topline">
                <span class="pill">Token #${entry.tokenId.toString()}</span>
                <span class="pill pill--accent">${escapeHtml(formatEth(entry.price))}</span>
              </div>
              <h3>Certificate Sale</h3>
              <div class="meta-row"><span>Seller</span><strong>${escapeHtml(
                shortenAddress(entry.seller),
              )}</strong></div>
              <div class="meta-row"><span>Buyer</span><strong>${escapeHtml(
                shortenAddress(entry.buyer),
              )}</strong></div>
              <div class="meta-row"><span>Royalty</span><strong>${escapeHtml(
                formatEth(entry.royaltyAmount),
              )}</strong></div>
              <div class="meta-row"><span>Platform Fee</span><strong>${escapeHtml(
                formatEth(entry.platformFeeAmount),
              )}</strong></div>
              <div class="meta-row"><span>Time</span><strong>${escapeHtml(
                formatTimestamp(entry.timestamp),
              )}</strong></div>
              <div class="history-links">
                ${
                  txUrl
                    ? `<a href="${escapeHtml(txUrl)}" target="_blank" rel="noreferrer">View transaction</a>`
                    : `<span class="mono muted">${escapeHtml(entry.txHash)}</span>`
                }
              </div>
            </article>
          `
        })
        .join('')}
    </div>
  `
}

function renderHistoryPanel() {
  if (!state.saleHistory.length) {
    return '<div class="empty-state">No completed sales have been recorded on this contract yet.</div>'
  }

  if (!state.account) {
    return renderHistoryList(
      state.saleHistory,
      'No completed sales have been recorded on this contract yet.',
    )
  }

  const account = state.account.toLowerCase()
  const salesAsSeller = state.saleHistory.filter((entry) => entry.seller.toLowerCase() === account)
  const purchasesAsBuyer = state.saleHistory.filter((entry) => entry.buyer.toLowerCase() === account)

  return `
    <div class="history-sections">
      <section class="panel panel--subtle">
        <div class="section-head">
          <div>
            <h3>Sales As Seller</h3>
            <p>Transfers where this wallet sold the certificate to a buyer.</p>
          </div>
        </div>
        ${renderHistoryList(salesAsSeller, 'This wallet has not completed any sales yet.')}
      </section>

      <section class="panel panel--subtle">
        <div class="section-head">
          <div>
            <h3>Purchases As Buyer</h3>
            <p>Transfers where this wallet bought the certificate from a seller.</p>
          </div>
        </div>
        ${renderHistoryList(purchasesAsBuyer, 'This wallet has not completed any purchases yet.')}
      </section>

      <section class="panel panel--subtle">
        <div class="section-head">
          <div>
            <h3>Recent Platform Sales</h3>
            <p>Latest sale activity across the whole contract.</p>
          </div>
        </div>
        ${renderHistoryList(state.saleHistory, 'No completed sales have been recorded on this contract yet.')}
      </section>
    </div>
  `
}

function renderPublishResult() {
  if (!state.publishResult) return ''

  return `
    <section class="panel panel--subtle">
      <div class="section-head">
        <div>
          <h3>Publish Complete</h3>
          <p>Keep the access key package safe. Without it, the encrypted source cannot be decrypted.</p>
        </div>
        <div class="inline-actions">
          <button class="button button--secondary" data-action="copy-access-key">Copy Access Key</button>
          <button class="button button--secondary" data-action="clear-publish-result">Hide Details</button>
        </div>
      </div>
      <div class="notice notice--success">
        Token #${escapeHtml(state.publishResult.tokenId)} is live.
        ${
          state.publishResult.explorerUrl
            ? `<a href="${escapeHtml(state.publishResult.explorerUrl)}" target="_blank" rel="noreferrer">View transaction</a>`
            : `<span class="mono">${escapeHtml(state.publishResult.txHash)}</span>`
        }
      </div>
      <div class="stack">
        <div>
          <strong>Metadata URI</strong>
          <div class="mono muted">${escapeHtml(state.publishResult.metadataURI)}</div>
        </div>
        <div>
          <strong>Encrypted Content URI</strong>
          <div class="mono muted">${escapeHtml(state.publishResult.encryptedContentURI)}</div>
        </div>
        <div>
          <strong>Access Key Package</strong>
          <pre class="key-box">${escapeHtml(state.publishResult.accessKey)}</pre>
        </div>
      </div>
    </section>
  `
}

function render() {
  root.innerHTML = `
    <div class="shell">
      <header class="hero">
        <div class="hero__copy">
          <span class="eyebrow">Digital Ownership Platform</span>
          <h1>Content Certificate Market</h1>
          <p>
            Publish novels, images, music, and files as encrypted IPFS-backed certificates. Ownership changes onchain.
            Access is granted through the certificate plus the offchain key package.
          </p>
        </div>
        <div class="hero__status">
          <div class="status-card">
            <span class="status-label">Chain</span>
            <strong>${escapeHtml(configuredChain.name)}</strong>
            <span class="muted">ID ${configuredChain.id}</span>
          </div>
          <div class="status-card">
            <span class="status-label">Wallet</span>
            <strong>${escapeHtml(shortenAddress(state.account))}</strong>
            <button class="button ${state.account ? 'button--secondary' : ''}" data-action="connect-wallet">
              ${state.account ? 'Reconnect Wallet' : 'Connect Wallet'}
            </button>
          </div>
        </div>
      </header>

      ${renderNotice()}

      <nav class="tabs">
        <button class="tab ${state.view === 'marketplace' ? 'tab--active' : ''}" data-action="switch-view" data-view="marketplace">Marketplace</button>
        <button class="tab ${state.view === 'publish' ? 'tab--active' : ''}" data-action="switch-view" data-view="publish">Publish</button>
        <button class="tab ${state.view === 'library' ? 'tab--active' : ''}" data-action="switch-view" data-view="library">My Library</button>
        <button class="tab ${state.view === 'history' ? 'tab--active' : ''}" data-action="switch-view" data-view="history">History</button>
      </nav>

      <main class="page">
        <section class="panel ${state.view === 'marketplace' ? '' : 'is-hidden'}">
          <div class="section-head">
            <div>
              <h2>Marketplace</h2>
              <p>Live onchain listings from the current contract address.</p>
            </div>
            <button class="button button--secondary" data-action="refresh-marketplace">Refresh Listings</button>
          </div>
          <div class="card-grid">${renderMarketplaceCards()}</div>
        </section>

        <section class="panel ${state.view === 'publish' ? '' : 'is-hidden'}">
          <div class="section-head">
            <div>
              <h2>Publish</h2>
              <p>Encrypt the source locally, upload the encrypted payload to IPFS, then mint and optionally list the certificate.</p>
            </div>
          </div>
          <form id="publish-form" class="form-grid">
            <div class="grid-two">
              <label class="field">
                <span>Title</span>
                <input class="input" name="title" placeholder="Night City Chapter One" required />
              </label>
              <label class="field">
                <span>Content Type</span>
                <select class="input" name="contentType">
                  ${contentTypeOptions
                    .map((option, index) => `<option value="${index}">${escapeHtml(option)}</option>`)
                    .join('')}
                </select>
              </label>
            </div>
            <label class="field">
              <span>Description</span>
              <textarea class="textarea" name="description" placeholder="Describe what the certificate represents."></textarea>
            </label>
            <div class="grid-two">
              <label class="field">
                <span>Royalty (%)</span>
                <input class="input" name="royaltyPercent" type="number" min="0" max="20" step="0.1" value="10" />
              </label>
              <label class="field">
                <span>List Price (ETH, optional)</span>
                <input class="input" name="listPrice" type="number" min="0" step="0.0001" placeholder="0.50" />
              </label>
            </div>
            <label class="field">
              <span>License / Access Note</span>
              <input class="input" name="license" value="certificate-owner-download" />
            </label>
            <div class="notice notice--info">
              The original content hash can only be minted once on this contract. Resales should happen by transferring the existing certificate, not by re-uploading the same file.
            </div>
            <div class="grid-two">
              <label class="field">
                <span>Original Content File</span>
                <input class="input" name="contentFile" type="file" required />
              </label>
              <label class="field">
                <span>Preview File (optional)</span>
                <input class="input" name="previewFile" type="file" />
              </label>
            </div>
            <div class="card__actions">
              <button class="button" type="submit">Encrypt, Mint, and Publish</button>
            </div>
          </form>
          ${renderPublishResult()}
        </section>

        <section class="panel ${state.view === 'library' ? '' : 'is-hidden'}">
          <div class="section-head">
            <div>
              <h2>My Library</h2>
              <p>Only the current certificate owner should keep the latest access key bundle.</p>
            </div>
            <button class="button button--secondary" data-action="refresh-library">Refresh Library</button>
          </div>
          <div class="card-grid">${renderLibraryCards()}</div>
        </section>

        <section class="panel ${state.view === 'history' ? '' : 'is-hidden'}">
          <div class="section-head">
            <div>
              <h2>History</h2>
              <p>Review completed certificate sales, including both buyer and seller addresses.</p>
            </div>
            <button class="button button--secondary" data-action="refresh-history">Refresh History</button>
          </div>
          ${renderHistoryPanel()}
        </section>
      </main>

      <footer class="footer">
        <span>${hasInjectedWallet() ? 'Injected wallet detected.' : 'No injected wallet detected yet.'}</span>
        <span>Contract: <span class="mono">${escapeHtml(getConfiguredContractLabel())}</span></span>
      </footer>
    </div>

    ${state.busyMessage ? `<div class="busy-overlay"><div class="busy-panel">${escapeHtml(state.busyMessage)}</div></div>` : ''}
  `
}

async function refreshMarketplace() {
  state.listedAssets = await fetchListedAssets(publicClient)
}

async function refreshLibrary() {
  if (!state.account) {
    state.ownedAssets = []
    return
  }

  state.ownedAssets = await fetchOwnedAssets(publicClient, state.account)
}

async function refreshHistory() {
  state.saleHistory = await fetchSaleHistory(publicClient)
}

async function syncCurrentView() {
  if (state.view === 'marketplace') {
    await refreshMarketplace()
  }

  if (state.view === 'library') {
    await refreshLibrary()
  }

  if (state.view === 'history') {
    await refreshHistory()
  }
}

async function ensureWallet() {
  if (state.wallet && state.account) return state.wallet

  const wallet = await connectInjectedWallet()
  state.wallet = wallet
  state.account = wallet.account
  return wallet
}

async function connectWallet() {
  clearNotice()
  setBusy('Connecting wallet and switching to the configured chain...')

  try {
    const wallet = await connectInjectedWallet()
    state.wallet = wallet
    state.account = wallet.account
    await syncCurrentView()
    setNotice('success', `Connected ${shortenAddress(wallet.account)} on ${wallet.chain.name}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wallet connection failed.'
    setNotice('error', message)
  } finally {
    state.busyMessage = null
    render()
  }
}

async function handlePublish(form: HTMLFormElement) {
  clearNotice()
  state.publishResult = null

  const formData = new FormData(form)
  const title = String(formData.get('title') || '').trim()
  const description = String(formData.get('description') || '').trim()
  const contentType = String(formData.get('contentType') || '0')
  const royaltyPercent = String(formData.get('royaltyPercent') || '10')
  const listPrice = String(formData.get('listPrice') || '').trim()
  const license = String(formData.get('license') || 'certificate-owner-download').trim()
  const contentFile = formData.get('contentFile')
  const previewFile = formData.get('previewFile')

  if (!(contentFile instanceof File) || contentFile.size === 0) {
    setNotice('error', 'Select the original content file before publishing.')
    return
  }

  const wallet = await ensureWallet()
  const credentials = getPinataCredentialsFromEnv()

  setBusy('Encrypting the file, uploading to IPFS, and minting the certificate...')

  try {
    const encrypted = await encryptFile(contentFile)
    const existingTokenId = await findRegisteredTokenIdByContentHash(publicClient, encrypted.contentHash)

    if (existingTokenId !== null) {
      throw new Error(
        `This original file is already registered as token #${existingTokenId.toString()}. Resell the existing certificate instead of minting a duplicate.`,
      )
    }

    const encryptedUpload = await uploadFileToPinata(encrypted.encryptedFile, credentials)
    const previewUpload =
      previewFile instanceof File && previewFile.size > 0
        ? await uploadFileToPinata(previewFile, credentials)
        : null

    const contentTypeLabel = contentTypeOptions[toContentTypeIndex(contentType)]
    const walletImage =
      previewUpload?.ipfsUri ||
      buildCertificateImageDataUri({
        title: title || contentFile.name,
        contentTypeLabel,
        creatorAddress: wallet.account,
      })

    const metadata = {
      name: title || contentFile.name,
      description,
      image: walletImage,
      external_url: typeof window !== 'undefined' ? window.location.origin : undefined,
      attributes: [
        { trait_type: 'Content Type', value: contentTypeLabel },
        { trait_type: 'Original Filename', value: contentFile.name },
        { trait_type: 'MIME Type', value: contentFile.type || 'application/octet-stream' },
        { trait_type: 'Encrypted Storage', value: 'IPFS' },
      ],
      assetType: contentTypeLabel,
      creator: wallet.account,
      previewURI: previewUpload?.ipfsUri || '',
      encryptedContentURI: encryptedUpload.ipfsUri,
      mimeType: contentFile.type || 'application/octet-stream',
      size: contentFile.size,
      contentHash: encrypted.contentHash,
      encryptionScheme: encrypted.encryptionScheme,
      originalFileName: contentFile.name,
      accessModel: 'owner-verified-offchain-key',
      license,
      createdAt: new Date().toISOString(),
    }

    const metadataUpload = await uploadJsonToPinata(metadata, credentials, 'content-metadata.json')
    const contractAddress = readRequiredContractAddress()
    const mintHash = await wallet.walletClient.writeContract({
      account: wallet.account,
      chain: wallet.chain,
      address: contractAddress,
      abi: CONTRACT_ABI,
      functionName: 'mint',
      args: [
        metadataUpload.ipfsUri,
        encryptedUpload.ipfsUri,
        previewUpload?.ipfsUri || '',
        encrypted.contentHash,
        toContentTypeIndex(contentType),
        toRoyaltyBps(royaltyPercent),
      ],
    })

    const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash })
    const tokenId = getMintedTokenId(mintReceipt)

    if (listPrice) {
      const approveHash = await wallet.walletClient.writeContract({
        account: wallet.account,
        chain: wallet.chain,
        address: contractAddress,
        abi: CONTRACT_ABI,
        functionName: 'approve',
        args: [contractAddress, tokenId],
      })

      await publicClient.waitForTransactionReceipt({ hash: approveHash })

      const listHash = await wallet.walletClient.writeContract({
        account: wallet.account,
        chain: wallet.chain,
        address: contractAddress,
        abi: CONTRACT_ABI,
        functionName: 'listForSale',
        args: [tokenId, parseEther(listPrice)],
      })

      await publicClient.waitForTransactionReceipt({ hash: listHash })
    }

    await Promise.all([refreshMarketplace(), refreshLibrary()])

    state.publishResult = {
      tokenId: tokenId.toString(),
      metadataURI: metadataUpload.ipfsUri,
      encryptedContentURI: encryptedUpload.ipfsUri,
      accessKey: encrypted.accessKey,
      txHash: mintHash,
      explorerUrl: buildExplorerTxUrl(mintHash) || '',
    }

    form.reset()
    setNotice('success', `Certificate #${tokenId.toString()} minted successfully.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publishing failed.'
    setNotice('error', message)
  } finally {
    state.busyMessage = null
    render()
  }
}

async function buyCertificate(tokenId: bigint, price: bigint) {
  const wallet = await ensureWallet()

  setBusy(`Buying token #${tokenId.toString()}...`)

  try {
    const hash = await wallet.walletClient.writeContract({
      account: wallet.account,
      chain: wallet.chain,
      address: readRequiredContractAddress(),
      abi: CONTRACT_ABI,
      functionName: 'buy',
      args: [tokenId],
      value: price,
    })

    await publicClient.waitForTransactionReceipt({ hash })
    await Promise.all([refreshMarketplace(), refreshLibrary(), refreshHistory()])
    setNotice('success', `Purchase complete for token #${tokenId.toString()}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Purchase failed.'
    setNotice('error', message)
  } finally {
    state.busyMessage = null
    render()
  }
}

async function cancelListing(tokenId: bigint) {
  const wallet = await ensureWallet()

  setBusy(`Canceling listing for token #${tokenId.toString()}...`)

  try {
    const hash = await wallet.walletClient.writeContract({
      account: wallet.account,
      chain: wallet.chain,
      address: readRequiredContractAddress(),
      abi: CONTRACT_ABI,
      functionName: 'cancelListing',
      args: [tokenId],
    })

    await publicClient.waitForTransactionReceipt({ hash })
    await Promise.all([refreshMarketplace(), refreshLibrary()])
    setNotice('success', `Listing canceled for token #${tokenId.toString()}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cancel listing failed.'
    setNotice('error', message)
  } finally {
    state.busyMessage = null
    render()
  }
}

async function downloadEncrypted(uri: string) {
  const response = await fetch(resolveIpfsUri(uri))
  if (!response.ok) {
    throw new Error(`Failed to download encrypted file: ${response.status}`)
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = 'encrypted-content.enc'
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

async function decryptAsset(tokenId: string, uri: string) {
  const accessKey = state.accessKeys[tokenId]

  if (!accessKey?.trim()) {
    setNotice('error', `Paste the access key package for token #${tokenId} first.`)
    return
  }

  setBusy(`Decrypting token #${tokenId} locally...`)

  try {
    const { blob, fileName } = await decryptFileFromUrl(resolveIpfsUri(uri), accessKey)
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(objectUrl)
    setNotice('success', `Decrypted file for token #${tokenId} is ready.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Decrypt failed.'
    setNotice('error', message)
  } finally {
    state.busyMessage = null
    render()
  }
}

root.addEventListener(
  'error',
  (event) => {
    const target = event.target
    if (!(target instanceof HTMLImageElement) || !target.classList.contains('card__image')) return

    let sources: string[] = []

    try {
      sources = JSON.parse(target.dataset.ipfsSrcs || '[]') as string[]
    } catch {
      sources = []
    }

    const nextIndex = Number(target.dataset.ipfsIndex || '0') + 1

    if (sources[nextIndex]) {
      target.dataset.ipfsIndex = String(nextIndex)
      target.src = sources[nextIndex]
      return
    }

    const placeholder = document.createElement('div')
    placeholder.className = 'card__image card__image--empty'
    placeholder.textContent = 'Preview unavailable'
    target.replaceWith(placeholder)
  },
  true,
)

root.addEventListener('click', async (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const button = target.closest<HTMLElement>('[data-action]')
  if (!button) return

  const action = button.dataset.action
  if (!action) return

  try {
    if (action === 'connect-wallet') {
      await connectWallet()
      return
    }

    if (action === 'switch-view') {
      const view = button.dataset.view as ViewName | undefined
      if (!view) return
      state.view = view
      clearNotice()
      setBusy(`Loading ${view} data...`)
      await syncCurrentView()
      state.busyMessage = null
      render()
      return
    }

    if (action === 'refresh-marketplace') {
      setBusy('Refreshing marketplace...')
      await refreshMarketplace()
      state.busyMessage = null
      render()
      return
    }

    if (action === 'refresh-library') {
      setBusy('Refreshing your library...')
      await refreshLibrary()
      state.busyMessage = null
      render()
      return
    }

    if (action === 'refresh-history') {
      setBusy('Refreshing transaction history...')
      await refreshHistory()
      state.busyMessage = null
      render()
      return
    }

    if (action === 'clear-publish-result') {
      state.publishResult = null
      render()
      return
    }

    if (action === 'copy-access-key') {
      if (!state.publishResult) return
      await navigator.clipboard.writeText(state.publishResult.accessKey)
      setNotice('success', 'Access key package copied to your clipboard.')
      return
    }

    if (action === 'buy') {
      await buyCertificate(BigInt(button.dataset.tokenId || '0'), BigInt(button.dataset.price || '0'))
      return
    }

    if (action === 'cancel-listing') {
      await cancelListing(BigInt(button.dataset.tokenId || '0'))
      return
    }

    if (action === 'download-encrypted') {
      setBusy('Downloading encrypted file from IPFS...')
      await downloadEncrypted(button.dataset.uri || '')
      state.busyMessage = null
      render()
      return
    }

    if (action === 'decrypt-asset') {
      await decryptAsset(button.dataset.tokenId || '', button.dataset.uri || '')
    }
  } catch (error) {
    state.busyMessage = null
    const message = error instanceof Error ? error.message : 'Action failed.'
    setNotice('error', message)
  }
})

root.addEventListener('input', (event) => {
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement)) return

  const tokenId = target.dataset.accessKeyInput
  if (!tokenId) return

  state.accessKeys[tokenId] = target.value
})

root.addEventListener('submit', async (event) => {
  const target = event.target
  if (!(target instanceof HTMLFormElement)) return
  if (target.id !== 'publish-form') return

  event.preventDefault()
  await handlePublish(target)
})

async function bootstrap() {
  render()
  detachWalletListeners()
  detachWalletListeners = attachWalletListeners(() => {
    void bootstrap()
  })

  try {
    state.wallet = await hydrateInjectedWallet()
    state.account = state.wallet?.account || null
    await syncCurrentView()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to restore wallet session.'
    state.notice = { tone: 'info', message }
  } finally {
    render()
  }
}

void bootstrap()
