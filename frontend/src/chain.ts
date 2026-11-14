/**
 * Optional live-chain read layer for the SealedMed registry on Diana.
 *
 * The demo runs fully locally by default. When the registry is deployed and
 * `VITE_REGISTRY_ADDRESS` is set, this module reads recipient commitments
 * and referral receipts back from the EVM contract through the public Diana
 * EVM RPC, using `@qorechain/evm`'s Diana chain definition and viem.
 * Reading the chain needs no wallet and no EVM authorisation window
 * (reads are outside the window; only writes are gated).
 */
import { createPublicClient, http, type Address, type Chain } from "viem";
import { qorechainTestnet } from "@qorechain/evm";

export const REGISTRY_ABI = [
  {
    type: "function",
    name: "recipients",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "kemKeyHash", type: "bytes32" },
      { name: "cardHash", type: "bytes32" },
      { name: "active", type: "bool" },
      { name: "registeredAt", type: "uint64" },
      { name: "updatedAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "receiptsCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isActiveRecipient",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function registryAddressFromEnv(): Address | null {
  const raw = import.meta.env.VITE_REGISTRY_ADDRESS as string | undefined;
  return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as Address) : null;
}

export function dianaPublicClient() {
  // `qorechainTestnet` is a standard viem chain object at runtime; the cast
  // only bridges a .d.ts version skew between @qorechain/evm 0.14.0's bundled
  // viem types and the viem version installed here.
  return createPublicClient({
    chain: qorechainTestnet as unknown as Chain,
    transport: http("https://evm-testnet.qore.host"),
  });
}

export async function readRecipientOnChain(registry: Address, recipient: Address) {
  const client = dianaPublicClient();
  const [kemKeyHash, cardHash, active, registeredAt, updatedAt] = await client.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "recipients",
    args: [recipient],
  });
  return { kemKeyHash, cardHash, active, registeredAt, updatedAt };
}

export async function readReceiptsCountOnChain(registry: Address): Promise<bigint> {
  const client = dianaPublicClient();
  return client.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "receiptsCount",
  });
}
