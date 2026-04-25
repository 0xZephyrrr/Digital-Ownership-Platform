require("dotenv").config()
require("@nomicfoundation/hardhat-toolbox")

const tenderlyUrl =
  process.env.TENDERLY_RPC_URL ||
  "https://virtual.sepolia.eu.rpc.tenderly.co/b1bfb292-efb9-4c44-b90f-6bf3b3480dd3"

const privateKey = process.env.PRIVATE_KEY
const accounts = privateKey ? [privateKey] : []
const networks = {
  hardhat: {},
  tenderlyVirtualSepolia: {
    url: tenderlyUrl,
    chainId: 99911155111,
    accounts,
  },
}

if (process.env.SEPOLIA_RPC_URL) {
  networks.sepolia = {
    url: process.env.SEPOLIA_RPC_URL,
    chainId: 11155111,
    accounts,
  }
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks,
}
