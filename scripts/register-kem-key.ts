/**
 * Register a receiving facility's ML-KEM-1024 encapsulation key on chain.
 *
 *   RECIPIENT_MNEMONIC="..." npm run register-kem
 *
 * READY TO RUN — but DO NOT run it until the live phase, and never with a
 * mnemonic that protects real funds. Diana is a testnet; use a dedicated
 * testnet mnemonic, provided through the environment only.
 *
 * What this does, in the only safe order:
 *   1. Derives the facility's native account + its canonical ML-DSA-87 key
 *      from the mnemonic (the wallet derivation — the same key QoreX/SDK
 *      derive for the account).
 *   2. `ensurePqcRegistered` — registers the ML-DSA-87 key if needed
 *      (idempotent; MUST precede any KEM registration, and for a brand-new
 *      account this registration is its first transaction, proof of
 *      possession included by the SDK).
 *   3. Derives the facility's QoreSeal keys from the SAME mnemonic
 *      (`deriveSealKeys`, index 0) — so the seal seed and the chain account
 *      share one backup — and broadcasts `msg.pqc.registerKemKey`
 *      (type URL /qorechain.pqc.v1.MsgRegisterKEMKey, algorithmId 2 =
 *      ML-KEM-1024, 1568-byte public key) with fee "auto".
 *   4. Reads the key back with `fetchKemKey` and prints the commitments the
 *      EVM registry entry must carry (sha256 of the KEM key), so the native
 *      registration and the `SealedMedRegistry` commitment can be checked
 *      against each other.
 *
 * The seal SECRET key never leaves this process and is never printed.
 */
import {
  createClient,
  deriveNativeAccount,
  derivePqcCanonical,
  directSignerFromPrivateKey,
  ensurePqcRegistered,
  fetchKemKey,
  msg,
} from "@qorechain/sdk";
import { deriveSealKeys, validateMlkemPublicKey } from "@qorechain/qoreseal";
import { kemKeyCommitment } from "../src-core/index.js";

const REST = "https://api-testnet.qore.host";
const RPC = "https://rpc-testnet.qore.host";
const ALGORITHM_ML_KEM_1024 = 2;

async function main() {
  const mnemonic = process.env.RECIPIENT_MNEMONIC;
  if (!mnemonic) {
    throw new Error(
      "RECIPIENT_MNEMONIC is not set. Provide the receiving facility's TESTNET mnemonic via the environment.",
    );
  }

  const client = createClient({ endpoints: { rest: REST, rpc: RPC } });
  const account = await deriveNativeAccount(mnemonic);
  const pqcKeypair = derivePqcCanonical(account.address, mnemonic);
  const signer = await directSignerFromPrivateKey(account.privateKey, "qor");
  const tx = await client.connectTx(signer, { pqcKeypair });

  console.log("Facility account:", account.address);

  // Step 2 — ML-DSA-87 first (idempotent).
  const reg = await ensurePqcRegistered(tx, {
    pqcKeypair,
    rest: REST,
    fee: { amount: [{ denom: "uqor", amount: "90000" }], gas: "600000" },
  });
  console.log("ML-DSA-87 registration:", reg.alreadyRegistered ? "already registered" : `tx ${reg.txHash}`);

  // Step 3 — the QoreSeal ML-KEM-1024 key, from the same mnemonic.
  const sealKeys = deriveSealKeys({ mnemonic });
  validateMlkemPublicKey(sealKeys.mlkemPublicKey);
  const result = await tx.signAndBroadcast(
    [
      msg.pqc.registerKemKey({
        sender: account.address,
        algorithmId: ALGORITHM_ML_KEM_1024,
        publicKey: sealKeys.mlkemPublicKey,
      }),
    ],
    "auto",
  );
  console.log("MsgRegisterKEMKey tx:", result.transactionHash);

  // Step 4 — read back and print the commitment for the EVM registry.
  const onChain = await fetchKemKey({ rest: REST, address: account.address });
  console.log("On-chain KEM key found:", onChain.found, "algorithmId:", onChain.key?.algorithmId);
  console.log("kemKeyHash (for SealedMedRegistry.registerRecipient):", kemKeyCommitment(sealKeys.mlkemPublicKey));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
