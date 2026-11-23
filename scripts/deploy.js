/**
 * Deploys MeritLinkRegistry and saves the address to deployments/<network>.json.
 *
 *   Local:    npx hardhat run scripts/deploy.js --network localhost
 *   Sepolia:  npx hardhat run scripts/deploy.js --network sepolia
 *
 * The deploying wallet becomes the university administrator (DEFAULT_ADMIN_ROLE).
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("==============================================");
  console.log(" MeritLink - deploying MeritLinkRegistry");
  console.log("==============================================");
  console.log(`Network  : ${network.name} (chainId ${network.config.chainId ?? (await ethers.provider.getNetwork()).chainId})`);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH`);

  const registry = await ethers.deployContract("MeritLinkRegistry", [deployer.address]);
  const deployTx = registry.deploymentTransaction();
  console.log(`Tx hash  : ${deployTx.hash}`);
  console.log("Waiting for confirmation...");
  await registry.waitForDeployment();
  const receipt = await deployTx.wait(network.name === "sepolia" ? 2 : 1);

  const address = await registry.getAddress();
  console.log(`\nMeritLinkRegistry deployed at: ${address}`);
  console.log(`Block    : ${receipt.blockNumber}`);
  console.log(`Gas used : ${receipt.gasUsed.toString()}`);

  const info = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    contract: "MeritLinkRegistry",
    address,
    admin: deployer.address,
    txHash: deployTx.hash,
    blockNumber: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
  };
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${network.name}.json`), JSON.stringify(info, null, 2));
  console.log(`Saved    : deployments/${network.name}.json`);

  if (network.name === "sepolia") {
    console.log(`\nEtherscan: https://sepolia.etherscan.io/address/${address}`);
    console.log("Verify source with:");
    console.log(`  npx hardhat verify --network sepolia ${address} ${deployer.address}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
