# Content Certificate Market Web App

这是一个不依赖 React 的轻量前端，使用 `Vite + TypeScript + viem` 完成：

- `Publish`
  本地加密文件、上传到 IPFS、调用合约铸造证书
- `Marketplace`
  读取链上挂牌并购买证书
- `My Library`
  查看当前钱包拥有的证书、下载加密文件、用访问密钥本地解密
- `History`
  读取链上 `Sale` 事件，展示买卖双方历史交易

## 本地开发

在 `Web-App/.env.local` 中配置：

```bash
VITE_CONTENT_NFT_ADDRESS=0xYourDeployedContract
VITE_CHAIN_ID=99911155111
VITE_TENDERLY_RPC_URL=https://virtual.sepolia.eu.rpc.tenderly.co/b1bfb292-efb9-4c44-b90f-6bf3b3480dd3
```

如果你只是本地用 `vite` 调试上传功能，可以临时加入：

```bash
VITE_PINATA_JWT=your_local_only_pinata_jwt
```

或：

```bash
VITE_PINATA_KEY=your_local_only_api_key
VITE_PINATA_SECRET=your_local_only_api_secret
```

运行：

```bash
npm install
npm run dev
```

## 在线部署到 Vercel

最推荐的黑客松展示方案是：

- 合约部署到链上
- 前端部署到 Vercel
- Pinata JWT 只放在 Vercel 的服务端环境变量中

### 1. 导入仓库

在 Vercel 导入这个仓库时，把 `Root Directory` 设为 `Web-App`。  
官方说明可参考 [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) 和 [Monorepo Root Directory](https://vercel.com/docs/monorepos)。

### 2. 前端环境变量

在 Vercel 项目里配置这些公开变量：

```bash
VITE_CONTENT_NFT_ADDRESS=0xYourDeployedContract
VITE_CHAIN_ID=99911155111
VITE_TENDERLY_RPC_URL=https://virtual.sepolia.eu.rpc.tenderly.co/b1bfb292-efb9-4c44-b90f-6bf3b3480dd3
```

可选：

```bash
VITE_EXPLORER_TX_BASE=https://your-explorer-base/tx
VITE_IPFS_GATEWAY_BASE=https://gateway.pinata.cloud/ipfs
```

### 3. 服务端环境变量

这个项目现在内置了 `Vercel Function`：

`/api/pinata/presign`

它会向 Pinata 请求短时上传 URL，再返回给浏览器使用，所以不需要把 Pinata JWT 暴露到前端。

在 Vercel 项目里配置这些**服务端变量**：

```bash
PINATA_JWT=your_server_side_pinata_jwt
PINATA_MAX_FILE_BYTES=104857600
PINATA_PRESIGN_TTL=60
UPLOAD_ALLOWED_ORIGINS=https://your-project.vercel.app
```

`UPLOAD_ALLOWED_ORIGINS` 可以填你自己的线上域名，多个值用逗号分隔。

### 4. 为什么不要把 Pinata JWT 放进 `VITE_*`

Vite 官方文档说明，只有以 `VITE_` 开头的变量才会暴露给客户端，而这些值会进入浏览器端代码包中：  
[Vite Env Variables and Modes](https://vite.dev/guide/env-and-mode)

所以：

- `VITE_PINATA_JWT` 只适合本地临时调试
- 正式线上展示应使用服务端 `PINATA_JWT`

Pinata 官方也提供了 `Presigned URLs` 方案，适合这种前端公开部署场景：  
[Pinata Presigned URLs](https://docs.pinata.cloud/files/presigned-urls)

## 当前内置网络

- `Anvil Local` (`31337`)
- `Sepolia` (`11155111`)
- `Tenderly Virtual Sepolia` (`99911155111`)

## 构建

```bash
npm run build
```
