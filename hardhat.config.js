require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Values come from .env (copy .env.example to .env). Never commit .env.
const { SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY, REPORT_GAS } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    localhost: { url: "http://127.0.0.1:8545" },
    // Only configured when both values exist, so tests run without any secrets.
    ...(SEPOLIA_RPC_URL && PRIVATE_KEY
      ? {
          sepolia: {
            url: SEPOLIA_RPC_URL,
            accounts: [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`],
            chainId: 11155111,
          },
        }
      : {}),
  },
  // Etherscan API V2: one key works for every supported chain, including Sepolia.
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
  sourcify: { enabled: false },
  gasReporter: {
    enabled: REPORT_GAS === "true",
    currency: "USD",
    outputFile: REPORT_GAS === "true" ? "docs/outputs/gas-report.txt" : undefined,
    noColors: true,
  },
};
