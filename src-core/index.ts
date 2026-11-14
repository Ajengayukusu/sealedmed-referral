/**
 * SealedMed core cryptography — the single source of truth used by BOTH the
 * browser frontend and the node test suite, so what is tested is what ships.
 *
 * Everything here is built on the REAL published packages:
 *   - `@qorechain/qoreseal` 0.1.0 — QoreSeal envelopes: the payload is encrypted
 *     once with a random AES-256-GCM data key; the data key is wrapped per
 *     recipient with ML-KEM-1024 (FIPS 203), and in the default `hybrid` mode
 *     combined with an X25519 agreement. The KEK derivation (HKDF-SHA-256)
 *     binds every envelope to `chainId` + `purpose`.
 *   - `@qorechain/qoresign` 0.1.0 — QoreSign hybrid message signatures
 *     (secp256k1 + ML-DSA-87, FIPS 204). This is what signs and verifies
 *     QoreSeal recipient cards: the card is the ML-DSA key binding.
 *   - `@qorechain/pqc` 0.2.3 — raw ML-DSA-87 signing for patient consent in
 *     this local demo.
 *
 * No plaintext document, no secret key and no seed ever leaves the device
 * that runs this module. Hashes (SHA-256) of public artefacts are the only
 * things designed to be published on chain.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import {
  ALGORITHM_ML_KEM_1024,
  ML_KEM_1024_PUBLIC_KEY_LENGTH,
  envelopeFromText,
  envelopeToText,
  generateSealKeys,
  open,
  recipientOf,
  seal,
  sealKeysFromSeed,
  validateMlkemPublicKey,
  verifyRecipientCard,
  type RecipientCard,
  type SealKeyPair,
  type SealRecipient,
} from "@qorechain/qoreseal";
import { recipientCardSignBytes, signRecipientCard } from "@qorechain/qoreseal";
import {
  addressFromPublicKey,
  classicalKeyFromPrivate,
  pqKeyFromSeed,
  type ClassicalKey,
  type PqKeyPair,
} from "@qorechain/qoresign";
import { mldsa87 } from "@qorechain/pqc";

/** Chain this application is bound to. Envelopes sealed for Diana cannot be
 *  opened under any other chain id — the chain id is inside the HKDF info. */
export const CHAIN_ID = "qorechain-diana";

/** QoreSeal purpose string. Part of the HKDF info of every envelope, so a
 *  SealedMed envelope cannot be replayed into a different application. */
export const PURPOSE = "sealedmed-referral";

export { ALGORITHM_ML_KEM_1024, ML_KEM_1024_PUBLIC_KEY_LENGTH };
export type { RecipientCard, SealKeyPair, SealRecipient };

/** SHA-256 hex digest — the commitment format stored on chain. Uses
 *  `@noble/hashes` so the identical code runs in Node and in the browser. */
export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return "0x" + toHex(sha256(bytes));
}

/** RFC 4122 v4 UUID from the platform CSPRNG (browser + Node >= 19). */
export function newConsentId(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const byte of b) s += byte.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(s: string): Uint8Array {
  const clean = s.replace(/^0x/, "");
  if (clean.length % 2 !== 0) throw new Error("hex string must have even length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/* ------------------------------------------------------------------ keys */

/** A facility's full local identity: QoreSeal keys (ML-KEM-1024 + X25519)
 *  plus the QoreChain account keys (classical + ML-DSA-87) that sign its
 *  recipient card. In production the account keys live in QoreX / the SDK
 *  wallet; in this demo they are generated locally from random secrets. */
export interface FacilityIdentity {
  /** QoreChain bech32 account address (`qor1...`), coin-type 118 form. */
  address: string;
  classicalKey: ClassicalKey;
  pqKey: PqKeyPair;
  sealKeys: SealKeyPair;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/**
 * Create a fresh facility identity (demo / first-run path).
 * The 32-byte secrets are random; whoever runs this owns the keys, and the
 * caller is responsible for persisting them — losing the seal seed means
 * losing access to every envelope sealed to this facility, permanently.
 */
export function createFacilityIdentity(): FacilityIdentity {
  const classicalKey = classicalKeyFromPrivate(randomBytes(32), "secp256k1");
  const address = addressFromPublicKey(classicalKey.publicKey, "secp256k1").bech32;
  const pqKey = pqKeyFromSeed(randomBytes(32));
  const sealKeys = generateSealKeys();
  return { address, classicalKey, pqKey, sealKeys };
}

/**
 * Deterministic identity from a 32-byte master seed (backup/restore path and
 * tests). Three domain-separated sub-seeds are derived with SHAKE-256 via
 * `@qorechain/pqc` so the classical, ML-DSA and seal keys never share raw
 * key material.
 */
export function facilityIdentityFromSeed(masterSeed: Uint8Array): FacilityIdentity {
  if (masterSeed.length !== 32) throw new Error("master seed must be 32 bytes");
  const sub = (label: string) =>
    shake256Of(new TextEncoder().encode(`sealedmed|${label}|`), masterSeed, 32);
  const classicalKey = classicalKeyFromPrivate(sub("classical"), "secp256k1");
  const address = addressFromPublicKey(classicalKey.publicKey, "secp256k1").bech32;
  const pqKey = pqKeyFromSeed(sub("mldsa"));
  const sealKeys = sealKeysFromSeed(sub("seal"));
  return { address, classicalKey, pqKey, sealKeys };
}

import { shake256 } from "@qorechain/pqc";
function shake256Of(prefix: Uint8Array, data: Uint8Array, outLen: number): Uint8Array {
  const input = new Uint8Array(prefix.length + data.length);
  input.set(prefix, 0);
  input.set(data, prefix.length);
  return shake256(input, outLen);
}

/* --------------------------------------------------------- recipient card */

/**
 * Create the facility's recipient card and sign it with the account's
 * hybrid (classical + ML-DSA-87) QoreSign keys.
 *
 * THE CARD IS THE ML-DSA KEY BINDING: it states "the X25519 key and the
 * ML-KEM-1024 key in this card belong to the QoreChain account `address`,
 * whose registered ML-DSA-87 key signed this statement". A sender must
 * verify the card (see {@link openRecipient}) before sealing anything:
 * sealing to an unverified card means trusting an unauthenticated key.
 */
export function createRecipientCard(
  identity: FacilityIdentity,
  opts: { chainId?: string; issuedAt?: Date | string } = {},
): RecipientCard {
  validateMlkemPublicKey(identity.sealKeys.mlkemPublicKey);
  return signRecipientCard({
    chainId: opts.chainId ?? CHAIN_ID,
    address: identity.address,
    keys: identity.sealKeys,
    classicalKey: identity.classicalKey,
    pqKey: identity.pqKey,
    issuedAt: opts.issuedAt,
  });
}

/** Canonical bytes of a card — hashed into the on-chain registry commitment. */
export function recipientCardBytes(card: RecipientCard): Uint8Array {
  return recipientCardSignBytes({
    chainId: card.chainId,
    address: card.address,
    mlkemKeySha3: card.mlkemKeySha3,
    x25519PublicKey: card.x25519PublicKey,
    issuedAt: card.issuedAt,
  });
}

/** Commitment stored on chain: sha256 of the recipient's ML-KEM-1024 key. */
export function kemKeyCommitment(mlkemPublicKey: Uint8Array): string {
  validateMlkemPublicKey(mlkemPublicKey);
  return sha256Hex(mlkemPublicKey);
}

/** Commitment stored on chain: sha256 of the canonical card bytes. */
export function cardCommitment(card: RecipientCard): string {
  return sha256Hex(recipientCardBytes(card));
}

export interface VerifiedRecipient {
  recipient: SealRecipient;
  address: string;
  kemKeyHash: string;
  cardHash: string;
}

/**
 * Verify a recipient card exactly the way a sender must before sealing:
 * against the recipient's *on-chain registered* ML-DSA-87 key and ML-KEM-1024
 * key. In the live flow those two keys come from the chain
 * (`/qorechain/pqc/v1/account/{address}` and `/qorechain/pqc/v1/kem/{address}`);
 * here they are parameters so the same code runs in tests, in the local demo
 * and against live chain data. Throws (QoreSealError `CARD_INVALID`) on any
 * mismatch — a forged card, a swapped X25519 key, or a key that does not
 * match the registered ML-KEM key are all rejected here.
 */
export function openRecipient(args: {
  card: RecipientCard;
  registeredPqPublicKey: Uint8Array;
  registeredMlkemPublicKey: Uint8Array;
  chainId?: string;
}): VerifiedRecipient {
  const recipient = verifyRecipientCard({
    card: args.card,
    chainId: args.chainId ?? CHAIN_ID,
    address: args.card.address,
    pqPublicKey: args.registeredPqPublicKey,
    mlkemPublicKey: args.registeredMlkemPublicKey,
  });
  return {
    recipient,
    address: args.card.address,
    kemKeyHash: kemKeyCommitment(args.registeredMlkemPublicKey),
    cardHash: cardCommitment(args.card),
  };
}

/* ---------------------------------------------------------------- sealing */

/** A referral document. FICTIONAL demo data only — never real patient data. */
export interface ReferralDocument {
  patientAlias: string;
  referringFacility: string;
  receivingFacility: string;
  reason: string;
  labSummary: string;
  createdAt: string;
}

export function referralDocumentBytes(doc: ReferralDocument): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(doc));
}

export interface SealedReferral {
  /** Binary QoreSeal envelope. Travels off chain clinic -> facility. */
  envelope: Uint8Array;
  /** Transport form: `qoreseal:` + base64url. */
  envelopeText: string;
  /** sha256 of the envelope — goes on chain in the receipt. */
  envelopeHash: string;
  /** sha256 of the plaintext document — commitment only, on chain. */
  docHash: string;
}

/**
 * Seal a referral document to a VERIFIED recipient. Client-side only: this
 * function is pure cryptography, it talks to no server and no chain.
 * Mode is QoreSeal's default `hybrid` (ML-KEM-1024 + X25519).
 */
export function sealReferral(args: {
  doc: ReferralDocument;
  to: VerifiedRecipient;
  chainId?: string;
  purpose?: string;
}): SealedReferral {
  const plaintext = referralDocumentBytes(args.doc);
  const envelope = seal({
    chainId: args.chainId ?? CHAIN_ID,
    purpose: args.purpose ?? PURPOSE,
    recipients: [args.to.recipient],
    plaintext,
    mode: "hybrid",
  });
  return {
    envelope,
    envelopeText: envelopeToText(envelope),
    envelopeHash: sha256Hex(envelope),
    docHash: sha256Hex(plaintext),
  };
}

/**
 * Open a sealed referral with the receiving facility's own seal keys.
 * Wrong keys, a wrong purpose, a wrong chain id or a tampered envelope all
 * throw — QoreSeal fails closed (AES-256-GCM authentication), it never
 * returns partial plaintext.
 */
export function openReferral(args: {
  envelope: Uint8Array;
  keys: SealKeyPair;
  chainId?: string;
  purpose?: string;
}): ReferralDocument {
  const plaintext = open({
    chainId: args.chainId ?? CHAIN_ID,
    purpose: args.purpose ?? PURPOSE,
    envelope: args.envelope,
    keys: args.keys,
  });
  return JSON.parse(new TextDecoder().decode(plaintext)) as ReferralDocument;
}

export { envelopeFromText, envelopeToText };

/* ---------------------------------------------------------- patient consent */

/**
 * Patient consent, signed with the patient's own ML-DSA-87 key
 * (`@qorechain/pqc` `mldsa87`). The signed statement binds the consent to
 * one specific referral: the document hash, the envelope hash, the sender,
 * the recipient, an issue time and an expiry. A consent for referral A
 * cannot authorise referral B, and an expired consent is rejected.
 */
export interface PatientConsent {
  consentId: string;
  patientAddress: string;
  senderAddress: string;
  recipientAddress: string;
  docHash: string;
  envelopeHash: string;
  issuedAt: number; // unix seconds
  expiresAt: number; // unix seconds
  /** ML-DSA-87 public key (2592 bytes), hex. On Diana this is the key
   *  registered for the patient's account. */
  publicKey: string;
  /** ML-DSA-87 signature (4627 bytes), hex. */
  signature: string;
}

const CONSENT_DOMAIN = "sealedmed-consent-v1";

export function consentStatement(c: Omit<PatientConsent, "publicKey" | "signature">): Uint8Array {
  return new TextEncoder().encode(
    [
      CONSENT_DOMAIN,
      CHAIN_ID,
      c.consentId,
      c.patientAddress,
      c.senderAddress,
      c.recipientAddress,
      c.docHash,
      c.envelopeHash,
      String(c.issuedAt),
      String(c.expiresAt),
    ].join("|"),
  );
}

/** The patient's key pair for the local demo (real ML-DSA-87). */
export function createPatientKey(seed?: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array } {
  if (seed) {
    // mldsa87 has no seed-based keygen in @qorechain/pqc 0.2.3; derive via qoresign.
    const kp = pqKeyFromSeed(seed);
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  }
  const kp = mldsa87.keygen();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

export function signConsent(args: {
  patientKey: { publicKey: Uint8Array; secretKey: Uint8Array };
  patientAddress: string;
  senderAddress: string;
  recipientAddress: string;
  docHash: string;
  envelopeHash: string;
  ttlSeconds?: number;
  nowSeconds?: number;
}): PatientConsent {
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const base: Omit<PatientConsent, "publicKey" | "signature"> = {
    consentId: newConsentId(),
    patientAddress: args.patientAddress,
    senderAddress: args.senderAddress,
    recipientAddress: args.recipientAddress,
    docHash: args.docHash,
    envelopeHash: args.envelopeHash,
    issuedAt: now,
    expiresAt: now + (args.ttlSeconds ?? 3600),
  };
  const signature = mldsa87.sign(args.patientKey.secretKey, consentStatement(base));
  return {
    ...base,
    publicKey: toHex(args.patientKey.publicKey),
    signature: toHex(signature),
  };
}

/**
 * Verify a patient consent. Returns `true` only when the ML-DSA-87 signature
 * verifies under the stated key AND the consent is inside its validity
 * window AND it is bound to exactly this referral (doc + envelope + parties).
 * Never throws on malformed input — a bad consent is `false`, not a crash.
 */
export function verifyConsent(
  consent: PatientConsent,
  expected: { docHash: string; envelopeHash: string; senderAddress: string; recipientAddress: string },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  try {
    if (consent.docHash !== expected.docHash) return false;
    if (consent.envelopeHash !== expected.envelopeHash) return false;
    if (consent.senderAddress !== expected.senderAddress) return false;
    if (consent.recipientAddress !== expected.recipientAddress) return false;
    if (nowSeconds < consent.issuedAt || nowSeconds > consent.expiresAt) return false;
    const { publicKey, signature, ...base } = consent;
    void publicKey;
    void signature;
    return mldsa87.verify(fromHex(consent.publicKey), consentStatement(base), fromHex(consent.signature));
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- receipt */

/** The receipt that is logged on chain via `SealedMedRegistry.logReferral`.
 *  Hashes and public metadata only — safe to publish. */
export interface ReferralReceipt {
  senderAddress: string;
  recipientAddress: string;
  envelopeHash: string;
  docHash: string;
  consentIdHash: string;
}

export function buildReceipt(args: {
  senderAddress: string;
  verified: VerifiedRecipient;
  sealed: SealedReferral;
  consent: PatientConsent;
}): ReferralReceipt {
  return {
    senderAddress: args.senderAddress,
    recipientAddress: args.verified.address,
    envelopeHash: args.sealed.envelopeHash,
    docHash: args.sealed.docHash,
    // consentId is a UUID string off chain; the registry stores its sha256.
    consentIdHash: sha256Hex(args.consent.consentId),
  };
}
