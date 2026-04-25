# Content Certificate Market

这个仓库现在已经从原来的 NFT demo 收敛成更适合正式维护的版本：

- 创作者上传原始文件
- 浏览器本地加密文件
- 加密后的资源上传到 IPFS
- Solidity 合约铸造内容所有权证书
- 证书可以挂牌和交易
- 当前持证人可以在 `My Library` 中下载加密文件并用访问密钥本地解密

同时工具链也已经做了轻量化：

- 后端：`Hardhat + Solidity`
- 前端：`Vite + TypeScript + viem`
- 已移除：`Foundry`、`React Router`、`RainbowKit`、本地 `localStorage` 市场 demo

## 当前结构

```text
Custom_NFT-main/
├── Ownership-Contract/   # Hardhat 合约、测试、部署脚本
├── Web-App/              # 轻量前端
└── docs/                 # 设计说明与 metadata 示例
```

## 产品边界

这个版本已经把“所有权证明”和“市场交易”做成了正式结构，但有一个事实必须说明：

**链上证书只能证明谁拥有内容，不能单独保证 IPFS 文件天然私密。**

这里的正式版采用的是：

- 原始文件先在浏览器本地加密
- 加密文件上传到 IPFS
- 所有人都可以看到加密文件的 URI
- 只有拿到访问密钥的人才能本地解密

所以目前的访问模型是：

- `证书所有权` 在链上
- `解密权限` 通过链下分享访问密钥完成

如果你后面要做完全自动的“买家一收到证书就自动拿到新密钥”，还需要再接一层密钥分发服务。

另外，当前版本新增了一层平台保护：

- 同一份原始内容的 `contentHash` 只能铸造一次
- 卖家卖出后，应该通过转售同一张证书完成二级交易
- 不能再拿同一文件重新铸造第二张“新的所有权证书”

这能防止“同一文件在平台内重复发行”，但不能从物理上抹掉上传者电脑里已经存在的明文副本。对数字内容来说，这一点无法只靠区块链彻底解决，仍然需要平台协议、侵权申诉和内容治理配合。

## 合约

核心合约在 [ContentNFTMarketplace.sol](/Users/Zhuanz/Custom_NFT-main/Ownership-Contract/contracts/ContentNFTMarketplace.sol:10)。

它实现了：

- `mint`
- `listForSale`
- `cancelListing`
- `buy`
- `withdraw`
- `withdrawPlatformFees`
- `canAccess`

这里采用的是**非托管挂牌**：

- 卖家挂牌时 NFT 仍然留在自己钱包里
- 市场只记录 listing
- 购买时市场合约基于授权完成转移

## 合约开发

### 测试

```bash
cd Ownership-Contract
npm install
npm test
```

### 部署

```bash
cd Ownership-Contract
cp .env.example .env
npm run deploy:tenderly
```

当前已经内置一条 Tenderly 测试链配置：

- RPC: `https://virtual.sepolia.eu.rpc.tenderly.co/b1bfb292-efb9-4c44-b90f-6bf3b3480dd3`
- Chain ID: `99911155111`

## 前端开发

先在 `Web-App/.env.local` 里配置：

```bash
VITE_CONTENT_NFT_ADDRESS=0xYourDeployedContract
VITE_CHAIN_ID=99911155111
VITE_TENDERLY_RPC_URL=https://virtual.sepolia.eu.rpc.tenderly.co/b1bfb292-efb9-4c44-b90f-6bf3b3480dd3
```

如果只是本地 `vite` 调试上传功能，可以临时再加：

```bash
VITE_PINATA_JWT=your_local_only_pinata_jwt
```

正式线上展示不要把 Pinata JWT 放进 `VITE_*`。当前版本已经内置了 `Vercel Function`：

```text
Web-App/api/pinata/presign.js
```

可以在 Vercel 服务端环境变量中配置：

```bash
PINATA_JWT=your_server_side_pinata_jwt
UPLOAD_ALLOWED_ORIGINS=https://your-project.vercel.app
PINATA_MAX_FILE_BYTES=104857600
PINATA_PRESIGN_TTL=60
```

然后运行：

```bash
cd Web-App
npm install
npm run dev
```

## 在线展示

黑客松演示最推荐的形式是：

- 合约部署到测试链
- 前端部署到 Vercel
- 在 Vercel 中把 `Root Directory` 设为 `Web-App`
- 浏览器上传走 `/api/pinata/presign`，不再暴露 Pinata JWT

更完整的说明在 [Web-App README](./Web-App/README.md)。

## 现在的正式版页面

- `Marketplace`
  浏览链上挂牌并购买证书
- `Publish`
  加密文件、上传到 IPFS、铸造并可选择立即挂牌
- `My Library`
  查看当前钱包拥有的证书、下载加密文件、输入访问密钥本地解密

## 钱包显示说明

现在生成的 metadata 已经包含主流钱包更容易识别的字段：

- `name`
- `description`
- `image`
- `attributes`

如果发布时没有上传预览图，系统会自动生成一张证书封面作为 NFT 展示图。

但如果你使用的是本地链或钱包本身不索引该网络，NFT 仍然可能不会自动出现在钱包的 NFT 列表中。这种情况下需要：

- 使用钱包支持的公开网络进行部署和铸造
- 或手动在钱包里导入合约地址与 Token ID

## 文档

- [平台设计说明](./docs/PLATFORM_REDESIGN.md)
- [metadata 示例](./docs/asset-metadata.example.json)
