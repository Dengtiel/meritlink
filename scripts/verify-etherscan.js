/**
 * Publishes the contract source on Sepolia Etherscan, so anyone can read the code that
 * enforces the rules. Reads the address from deployments/sepolia.json.
 *   npm run verify:sepolia
 */
const fs = require("fs");
const path = require("path");
process.env.HARDHAT_NETWORK = "sepolia";
const hre = require("hardhat");

async function main() {
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "sepolia.json"), "utf8"));
  console.log(`Verifying ${info.address} (constructor admin ${info.admin}) on Sepolia Etherscan...`);
  await hre.run("verify:verify", { address: info.address, constructorArguments: [info.admin] });
  console.log(`Source verified: https://sepolia.etherscan.io/address/${info.address}#code`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
