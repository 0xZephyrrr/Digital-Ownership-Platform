# Web App

This front end is a lightweight `Vite + TypeScript + viem` app for the digital ownership certificate platform.

## Views

- `Publish`: encrypt a file, upload certificate metadata to IPFS, and mint the NFT certificate.
- `Marketplace`: browse active listings and purchase certificates.
- `My Library`: inspect owned certificates, download encrypted assets, and decrypt them with the saved access key.
- `History`: review past sales as buyer or seller from onchain `Sale` events.

## Environment Variables

Create `.env.local` for local overrides.

```bash
VITE_CONTENT_NFT_ADDRESS=0xYourContract
VITE_CHAIN_ID=99911155111
VITE_TENDERLY_RPC_URL=https://virtual.sepolia.eu.rpc.tenderly.co/b1bfb292-efb9-4c44-b90f-6bf3b3480dd3
```

Optional public client settings:

```bash
VITE_EXPLORER_TX_BASE=https://your-explorer/tx
VITE_IPFS_GATEWAY_BASE=https://gateway.pinata.cloud/ipfs
VITE_PINATA_PRESIGN_ENDPOINT=https://your-deployment.example/api/pinata/presign
```

Optional local-only Pinata credentials for direct browser uploads:

```bash
VITE_PINATA_JWT=local_dev_only_jwt
# or
VITE_PINATA_KEY=local_dev_only_key
VITE_PINATA_SECRET=local_dev_only_secret
```

Optional upload routing controls:

```bash
# Metadata and preview uploads are always forced onto Public IPFS so wallets can render the NFT.
# Keep content public too unless you have implemented a private access-link download endpoint.
VITE_PINATA_CONTENT_NETWORK=public
PINATA_CONTENT_NETWORK=public
```

## Upload Architecture

For a wallet-compatible NFT, these resources must stay public:

- `tokenURI` metadata JSON
- NFT preview image used in `image`
- optional `previewURI`

This app now forces `metadata` and `preview` uploads onto Pinata Public IPFS. Encrypted source files can be routed separately, but the default is still `public` because the current library download flow fetches encrypted blobs from a public gateway and decrypts them client-side.

If you later switch `PINATA_CONTENT_NETWORK=private`, you must also add a private access-link or proxy download endpoint; otherwise `My Library` downloads will stop working.

## Cloudflare Pages

1. Push the repo to GitHub.
2. In Cloudflare Dashboard, open `Workers & Pages -> Create application -> Pages -> Connect to Git`.
3. Select this repository.
4. Build settings:
   - Framework preset: `Vite`
   - Root directory: `Web-App`
   - Build command: `npm run build`
   - Build output directory: `dist`
5. Add build-time variables:

```bash
VITE_CONTENT_NFT_ADDRESS=0xe4FBE59E931E6dd8B3374d7b89576e97BcFB0317
VITE_CHAIN_ID=99911155111
VITE_TENDERLY_RPC_URL=https://virtual.sepolia.eu.rpc.tenderly.co/b1bfb292-efb9-4c44-b90f-6bf3b3480dd3
```

6. After the project is created, open `Settings -> Variables and Secrets` and add:

Public variables:

```bash
UPLOAD_ALLOWED_ORIGINS=https://digital-ownership-platform.pages.dev
PINATA_MAX_FILE_BYTES=104857600
PINATA_PRESIGN_TTL=60
PINATA_CONTENT_NETWORK=public
```

Secret:

```bash
PINATA_JWT=your_server_side_pinata_jwt
```

7. Redeploy after changing variables.

Cloudflare Pages Functions entry point:

- `functions/api/pinata/presign.js`

## Vercel

1. Import the repository and set `Root Directory` to `Web-App`.
2. Build settings:
   - Build command: `npm run build`
   - Output directory: `dist`
3. Add environment variables:

Public variables:

```bash
VITE_CONTENT_NFT_ADDRESS=0xe4FBE59E931E6dd8B3374d7b89576e97BcFB0317
VITE_CHAIN_ID=99911155111
VITE_TENDERLY_RPC_URL=https://virtual.sepolia.eu.rpc.tenderly.co/b1bfb292-efb9-4c44-b90f-6bf3b3480dd3
```

Server-side variables:

```bash
PINATA_JWT=your_server_side_pinata_jwt
UPLOAD_ALLOWED_ORIGINS=https://your-project.vercel.app
PINATA_MAX_FILE_BYTES=104857600
PINATA_PRESIGN_TTL=60
PINATA_CONTENT_NETWORK=public
```

Vercel serverless signer entry point:

- `api/pinata/presign.js`
