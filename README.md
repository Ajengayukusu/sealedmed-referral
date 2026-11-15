# SealedMed Referral — Post-Quantum Encrypted Medical Referrals

[![Built on QoreChain](https://build.qorechain.io/badge/sealedmed-referral.svg)](https://build.qorechain.io/p/sealedmed-referral)

**Live demo:** https://ajengayukusu.github.io/sealedmed-referral/

**Demo video (≤ 3 min):** https://www.youtube.com/watch?v=InHyHG0eWX0

> **Rujukan medis & hasil lab yang tetap rahasia selama puluhan tahun — dienkripsi
> ML-KEM-1024 di browser, terikat ML-DSA-87, dengan receipt hash-only on-chain.**
> Built for the **QoreChain Developer Fest "Build Before Q-Day"** — **Encrypted Apps** category.
> Testnet: **QoreChain Diana** (`qorechain-diana`, EVM chain ID 9800) · License: MIT
> ⚠ All patient data in this repo and demo is **FICTIONAL**. Never input real medical data.

---

## ⏱ Judge path — 3 minutes

1. **The problem (30 s).** Medical referrals and lab results must stay secret for
   *decades* — longer than classical encryption can promise. Anything encrypted
   today with RSA/ECDH can be recorded by an attacker and decrypted after Q-Day
   (*harvest now, decrypt later*). Health data is the canonical worst case:
   it cannot be "rotated" like a password, and its sensitivity does not expire.
2. **The fix (30 s).** The receiving facility registers an **ML-KEM-1024**
   (FIPS 203) key on chain and publishes a **recipient card signed with its
   ML-DSA-87 key** (the key binding). The sending clinic verifies the card,
   then encrypts the referral **in the browser** with QoreSeal (hybrid
   ML-KEM-1024 + X25519, AES-256-GCM). The patient consents with an
   **ML-DSA-87 signature**. The chain stores only **hashes and a receipt** —
   never plaintext, never the envelope payload, never a private key.
3. **Proof it works (60 s).** Run the two test suites — **15 crypto tests**
   against the *real* `@qorechain/qoreseal` / `@qorechain/pqc` packages
   (roundtrip + wrong key, wrong purpose, wrong chain, tampered envelope,
   forged card, forged/expired consent) and **12 contract tests**:
   ```bash
   npm install && npm test
   ```
4. **See it (60 s).** Open the hosted demo at https://ajengayukusu.github.io/sealedmed-referral/
   — three roles (receiving doctor, sending clinic, patient), and *every
   cryptographic step in the browser is real*, using the same `src-core/`
   module the tests exercise. Or run it locally:
   ```bash
   cd frontend && npm install && npm run dev   # http://localhost:5174
   ```
5. **Deployment status: LIVE on Diana.** The registry is deployed, the
   receiving facility's ML-KEM-1024 key is registered on chain, its signed
   recipient card is committed in the registry, and a complete fictional
   referral (seal → consent → on-chain receipt → doctor opens it) has been
   executed end-to-end. Every hash is in the evidence table below and in
   [`deployments.testnet.json`](deployments.testnet.json) — verify them
   against the chain, not against this README.

---

## How it works

```
 RECEIVING FACILITY (doctor)              SENDING CLINIC                    PATIENT
 ───────────────────────────              ──────────────                    ───────
 ML-KEM-1024 key ──► registerKemKey ──►  (native lane, algorithmId 2)
 recipient card ─── sign ML-DSA-87 ──►   verify card against the
 (X25519 + KEM key bound to              registered ML-DSA + KEM keys
  the account)                                    │
                                          seal document IN BROWSER
                                          (QoreSeal hybrid) ──────►  consent:
                                                                     ML-DSA-87 signature
                                          ◄────────────────────────  over doc+envelope hashes
                                          logReferral(hashes) ──►  SealedMedRegistry (EVM)
 envelope (off chain) ───────────────────────────────────────────►  doctor opens it
                                                                    IN BROWSER with
                                                                    its own seal keys
```

**What the chain sees:** the KEM key registration (a public key), the EVM
registry commitments (`sha256(kemKey)`, `sha256(card)`), and receipts
(sender, recipient, envelope hash, document hash, consent id hash, time).
**What the chain never sees:** the document, the envelope contents, any
secret key, any seed.

### The cryptography — exact APIs used (verified against the installed packages)

| Piece | Package | Exact functions |
|---|---|---|
| Seal keys | `@qorechain/qoreseal` 0.1.0 | `generateSealKeys()`, `sealKeysFromSeed(seed)`, `deriveSealKeys({mnemonic})`, `recipientOf(keys)` |
| Recipient card (key binding) | `@qorechain/qoreseal` 0.1.0 | `signRecipientCard({chainId, address, keys, classicalKey, pqKey})`, `verifyRecipientCard({card, chainId, address, pqPublicKey, mlkemPublicKey})`, `recipientCardSignBytes(fields)` |
| Hybrid signature primitives | `@qorechain/qoresign` 0.1.0 | `classicalKeyFromPrivate`, `pqKeyFromSeed`, `addressFromPublicKey` (card signing itself is QoreSeal's, over QoreSign `signMessage`) |
| Envelope | `@qorechain/qoreseal` 0.1.0 | `seal({chainId, purpose, recipients, plaintext, mode:"hybrid"})`, `open({chainId, purpose, envelope, keys})`, `envelopeToText` / `envelopeFromText` |
| Patient consent | `@qorechain/pqc` 0.2.3 | `mldsa87.sign(secretKey, message)`, `mldsa87.verify(publicKey, message, signature)`, `shake256` |
| On-chain KEM registration | `@qorechain/sdk` 0.14.0 | `ensurePqcRegistered(...)` then `msg.pqc.registerKemKey({sender, algorithmId: 2, publicKey})`, read-back `fetchKemKey(...)` |
| Registry reads (frontend) | `@qorechain/evm` 0.14.0 + viem | `qorechainTestnet` chain + `readContract` on `SealedMedRegistry` |

Constants that matter: ML-KEM-1024 public key **1568 bytes**, algorithm id
**2**; ML-DSA-87 public key 2592 bytes, signature 4627 bytes; every envelope
is bound to `chainId = "qorechain-diana"` and `purpose = "sealedmed-referral"`
through the HKDF info string `qorechain-kem-v1|<chainId>|<purpose>` — an
envelope sealed for another chain or purpose **cannot be opened here**
(test-covered).

> **API note (found while building, recorded honestly):** the task brief
> assumed consent would use `@qorechain/pqc`'s `mldsa` export; 0.2.3 exports
> the algorithm objects as `mldsa87` / `mldsa65` / `mldsa44` (plus an
> `mldsa` alias family) with `keygen() / sign(secretKey, msg) /
> verify(publicKey, msg, sig)`. QoreSeal 0.1.0 also ships its own card
> machinery — SealedMed uses it instead of hand-rolling card signatures, so
> the binding format is the ecosystem's canonical one and stays verifiable
> by any QoreSeal implementation.

---

## Category requirements → evidence

| Encrypted Apps requirement | Where SealedMed satisfies it | Evidence |
|---|---|---|
| ML-KEM-1024 encryption | QoreSeal hybrid envelopes: payload AES-256-GCM, data key wrapped per recipient with ML-KEM-1024 (+ X25519 in hybrid mode) | `src-core/index.ts` (`sealReferral`) + roundtrip tests |
| Registered recipient keys | `scripts/register-kem-key.ts` broadcasts `MsgRegisterKEMKey` (algorithmId 2) after `ensurePqcRegistered`, and reads the key back with `fetchKemKey`; the EVM `SealedMedRegistry` mirrors the commitment as `sha256(kemKey)` | **Live:** KEM registration tx `F5281075…AB9772` (height 10087351), read-back `found:true, mlkem1024`; registry entry active — see "On-chain proof" below |
| ML-DSA key binding | Recipient card signed by the facility's ML-DSA-87 account key via QoreSign hybrid signatures; senders must pass `verifyRecipientCard` against the *registered* keys before sealing — forged/swapped cards are rejected | `createRecipientCard` / `openRecipient` + 3 negative card tests |
| Client-side encryption & decryption | `seal` / `open` run in the browser (frontend bundles the same `src-core`); no server ever receives plaintext, envelopes or keys | Frontend build + architecture above |
| Consent & audit trail | Patient ML-DSA-87 consent bound to doc+envelope hashes with expiry; chain receipt = hashes only | `signConsent` / `verifyConsent` + consent tests; `SealedMedRegistry.logReferral` |

## On-chain proof — Diana testnet (LIVE)

Executed end-to-end on 15 Nov 2026 with the bootstrap order below. The
receiving facility ("doctor") is the unified account
`qor1359rgl28y45dldscnjzxqvcz6pz0qyrmjq488c` / `0x8d0A347d472568DfB6189c84603302d044F0107b`;
the sending clinic is `qor1dcse33ce3n3mwxxleuupqvfqeq6xl552zm2ltk` /
`0x6E2198c7198Ce3B718DFCf38103120C8346fD28A`. Commitments are SHA-256,
exactly as `kemKeyCommitment` / `cardCommitment` in `src-core` define them.

| Step | Evidence |
|---|---|
| Doctor ML-DSA-87 registered (prerequisite) | `GET /qorechain/pqc/v1/account/qor1359…488c` → `found:true, possession_proven:true` (`ensurePqcRegistered` was a no-op in this run) |
| ML-KEM-1024 key registered on chain | Native tx `F528107596E50F0342C9ACD0527A75338BD331A8233023BB436214D925AB9772`, height **10087351**, code 0; read-back `GET /qorechain/pqc/v1/kem/qor1359…488c` → `found:true, algorithm_id 2 (mlkem1024)`, key byte-identical to the doctor's QoreSeal key |
| Recipient card (key binding) | Signed with the doctor's real account keys via `signRecipientCard`; verified with `verifyRecipientCard` against the **on-chain** registered ML-DSA + ML-KEM keys. `kemKeyHash = 0x0d239bda…dde582f`, `cardHash = 0x1fbaa3c1…ff0f0df0` |
| Registry deployed | `SealedMedRegistry` at **`0x9aa1EF27d14F46e5Fbe399CE2402fDc0673b65C1`**, deploy tx `0xdb0fe86a…88fc34e`, block **10087345** |
| Recipient committed in registry | `registerRecipient` tx `0x965b2bf3…e2959d`, block **10087354**; `recipients(doctor)` → active, both hashes match the card |
| Fictional referral sealed + consented | QoreSeal hybrid envelope, `envelopeHash = 0xd28eb7a4…391d93a6`, `docHash = 0x7bd53e1c…0d858813`; patient ML-DSA-87 consent verified locally before logging (consent id hash `0x089b16e8…1fde49c`) |
| Receipt logged on chain | `logReferral` tx `0x2dcbc2cd…b62e723`, block **10087356**; `receipts(0)` matches sender, recipient and all three hashes; `receiptsCount = 1` |
| Doctor opens the envelope | `open()` with the doctor's own seal keys recovered the fictional document **byte-identical** to the original — the full loop closes off chain, the chain holds hashes only |

## Run it

```bash
# crypto core + contracts (27 tests total)
npm install
npm test            # hardhat (12) + node:test crypto suite (15)
npm run test:core   # crypto only

# frontend demo (local, no chain needed)
cd frontend
npm install
npm run dev         # http://localhost:5174
npm run build       # production build check
```

### Bootstrap order for the live phase (do NOT reorder)

1. **Faucet** — fund each facility account at https://dashboard.qorechain.io/faucet
   (paste the `qor1...` address; 100 QOR / 24 h).
2. **Register ML-DSA-87 + ML-KEM-1024 keys** (native lane):
   ```bash
   RECIPIENT_MNEMONIC="..." npm run register-kem
   ```
   The script registers the ML-DSA key first (idempotent), then the KEM key,
   then prints the `kemKeyHash` commitment.
3. **Open a scoped EVM window** for the deployer (hybrid-signed), then deploy
   the registry:
   ```bash
   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy.ts --network diana
   ```
4. Register the facility in `SealedMedRegistry` with the printed
   `kemKeyHash` + the card hash, and set `VITE_REGISTRY_ADDRESS` in the
   frontend so receipts/recipients are read back from Diana.

---

## Threat model — harvest now, decrypt later is the headline

| Attack | Defence in SealedMed | Test / evidence |
|---|---|---|
| Attacker records today's referral traffic, decrypts after Q-Day with a quantum computer | The envelope's key establishment is ML-KEM-1024 (+ X25519 hybrid): no classical key exchange to harvest. The part a quantum attacker would need — the KEM secret — never travels | QoreSeal construction; roundtrip tests |
| Attacker swaps the doctor's X25519/KEM key (fake "recipient card") to receive referrals themselves | The card is signed by the account's ML-DSA-87 key; clinic verifies it against the **registered** on-chain keys before sealing. A swapped key or forged signature fails verification | "card whose X25519 key was swapped is rejected" · "forged signature is rejected" |
| Attacker replays an old patient consent for a new referral | Consent signs the exact doc hash + envelope hash + parties + expiry; any change fails | "consent bound to another referral is rejected" · "expired consent is rejected" |
| Attacker tampers with an envelope in transit | AES-256-GCM authentication inside the envelope; one flipped bit fails `open` | "tampered envelope fails" (head + tail) |
| Attacker opens an envelope with their own keys | Not a recipient → decapsulation yields nothing usable; `open` throws | "opening with the wrong facility keys fails" |
| Attacker moves an envelope to another app/chain (cross-context replay) | HKDF binding to chainId + purpose: wrong purpose or chain id fails `open` | purpose/chainId negative tests |
| Curious server / chain observer reads the medical data | There is no server in the data path; the chain stores only SHA-256 commitments and receipt metadata | Contract stores hashes only (`SealedMedRegistry.sol`) |
| Facility key compromised | Revoke in the registry (`revokeRecipient`) — new referrals to it are rejected on chain; rotate with `updateRecipient` / re-register | Contract revoke + re-register tests |

## Honest limits

- **QoreSeal envelopes are not signed by default.** Anyone can seal *to* a
  public key — encryption proves confidentiality, not sender authenticity.
  SealedMed mitigates this at the workflow layer (verified recipient card +
  patient consent + on-chain receipt binding the sender), but a deployment
  that needs sender authentication should additionally sign the envelope
  hash with the sender's QoreSign key. We state this instead of hiding it.
- **Metadata is public.** Sender, recipient, timing and hashes are visible
  in the receipt — that a referral happened between two facilities is not
  hidden; what it says is. Envelope size roughly reveals document size.
- **Losing the seal seed = losing the data.** If a facility loses its seed /
  mnemonic, envelopes sealed to it are unrecoverable — by design; there is
  no escrow or backdoor. Facilities must back up the seed like a wallet.
- **Removing a KEM key from the registry does not un-deliver envelopes.**
  Revocation stops new referrals; it cannot recall data already sealed and
  sent off chain.
- **QoreSeal is pre-1.0 (0.1.0) and pending external review**, per its own
  documentation. The construction uses NIST-standardised primitives
  (ML-KEM-1024 / FIPS 203, ML-DSA-87 / FIPS 204, AES-256-GCM), but the
  envelope format itself has not had a public third-party audit yet.
- **Demo identities are local.** In the demo, facility/patient keys are
  generated in the browser/on the test machine; in production they are the
  accounts' real QoreX/SDK keys, and the "registered keys" a sender checks
  come from the chain, not from the counterparty.
- **Not a medical product.** This is a contest prototype with fictional
  data — not certified for real health data, not legal/medical advice, and
  real deployments need their own compliance review (UU PDP, Permenkes,
  SATUSEHAT interoperability, …).
- **Deployed on Diana testnet (see "On-chain proof").** The live run used
  the contest's shared throwaway facility accounts; the receiving
  facility's demo seal keys are derived deterministically from that
  testnet mnemonic (label `sealedmed-doctor`) so the demo is reproducible
  by the team — a production facility would generate and guard its own
  seed in QoreX instead. Testnet only; nothing here touches mainnet.

## Repository layout

```
src-core/          Shared TypeScript crypto core (frontend + tests import THIS)
  index.ts         keys, recipient cards, seal/open, patient consent, receipts
  test/            15 node:test cases incl. 9 negative/attack cases
contracts/         SealedMedRegistry.sol — hash-only registry + receipts
test/              SealedMedRegistry.test.ts — 12 Hardhat tests incl. negatives
scripts/           deploy.ts (Diana registry) · register-kem-key.ts (native lane)
frontend/          Vite + React + TS, 3-role demo, real client-side crypto
AI_USAGE.md        How AI was used to build this project, and what humans decided
```

## Credits

Built with the official QoreChain stack: `@qorechain/qoreseal` 0.1.0,
`@qorechain/qoresign` 0.1.0, `@qorechain/pqc` 0.2.3, `@qorechain/sdk` /
`@qorechain/evm` 0.14.0, `@noble/hashes`, OpenZeppelin Contracts 5 and
Hardhat. Fest: https://build.qorechain.io — docs:
https://docs.qorechain.io/build-before-qday
