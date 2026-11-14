import { ethers } from "hardhat";

/**
 * Deploy SealedMedRegistry to QoreChain Diana testnet (EVM chain ID 9800).
 *
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy.ts --network diana
 *
 * PREREQUISITES — in this exact order (see README "Bootstrap order"):
 *   1. Fund the deployer (coin-type 60 account) from the faucet:
 *      https://dashboard.qorechain.io/faucet  (paste the qor1... address)
 *   2. Register the deployer's ML-DSA-87 key on the native lane — this MUST
 *      be the account's first transaction (MsgRegisterPQCKeyV2 + proof of
 *      possession), e.g. via the QoreChain SDK `ensurePqcRegistered`.
 *   3. Open a SCOPED EVM authorisation window for the deployer covering this
 *      deployment (contract creation consumes one window transaction).
 *   4. Only then run this script. Without steps 2–3 the EVM lane rejects the
 *      deployment transaction (pqc codes 26/27/28).
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account. Set DEPLOYER_PRIVATE_KEY in the environment.");
  }
  const network = await ethers.provider.getNetwork();
  console.log("Deployer:", deployer.address);
  console.log("Chain ID:", network.chainId.toString(), "(expect 9800 = Diana)");
  if (network.chainId !== 9800n) {
    throw new Error("Refusing to deploy: this script targets Diana (9800) only.");
  }
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance (wei):", balance.toString());

  const Registry = await ethers.getContractFactory("SealedMedRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const tx = registry.deploymentTransaction();
  console.log("SealedMedRegistry deployed to:", address);
  console.log("Deployment tx hash:", tx?.hash ?? "(unknown)");
  console.log("Verify on the explorer: https://explore.qore.network (switch to Testnet)");
  console.log(
    JSON.stringify(
      {
        network: "qorechain-diana",
        chainId: 9800,
        contract: "SealedMedRegistry",
        address,
        deployTx: tx?.hash ?? null,
        deployer: deployer.address,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
