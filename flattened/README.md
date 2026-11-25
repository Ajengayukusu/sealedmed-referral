# QCAI audit — paste source for SealedMedRegistry

## What this is

`SealedMedRegistry.flattened.sol` is the flattened source of the deployed
SealedMed contract, prepared for the QoreChain dashboard contract auditor
(QCAI) at https://dashboard.qorechain.io/audit.

| Item | Value |
|---|---|
| Contract | `SealedMedRegistry` (`contracts/SealedMedRegistry.sol`) |
| Deployed address (Diana testnet, chain 9800) | `0x9aa1EF27d14F46e5Fbe399CE2402fDc0673b65C1` |
| Deploy tx | `0xdb0fe86a48dc330a6461f36be017a61fbc883ead7103f78ee13edb67588fc34e` |
| Source commit | `03e2537be512c6c4cb3a7e68426aef139ec5b98f` (initial commit — the contract file has never changed since; the deployed source is this source) |
| Flattened with | `npx hardhat flatten contracts/SealedMedRegistry.sol` (hardhat v2.29.2) |

**Fidelity check (reproduce it):** diff this flattened file against
`contracts/SealedMedRegistry.sol` starting at the `pragma solidity` line —
the two are byte-identical from that line to EOF. The only differences in
the whole file are hardhat's flatten banner comments above the SPDX line.
The contract has no imports and the flattened file contains no test code.

## How to run the audit

1. Open https://dashboard.qorechain.io/audit and sign in.
2. The form has **no file upload** — paste the **entire contents** of
   `SealedMedRegistry.flattened.sol` into the "Contract Source Code" field.
3. Set **Blockchain = QoreChain**.
4. Run the audit and confirm the payment prompt if shown (the dashboard
   displays an audit cost of 150 QOR — testnet QOR only).
5. The dashboard does **not** keep an audit history and issues no public
   report URL: export the PDF immediately and store it in the repo as
   `docs/QCAI-audit-stage<N>.pdf`, with a written triage of every finding in
   `docs/QCAI-stage<N>-triage.md`. For a second stage, run a fresh audit
   with this exact same source.

## Auditor context — what this contract honestly is

`SealedMedRegistry` is a **hash-only registry** for post-quantum encrypted
medical referrals on QoreChain Diana. It is the audit log, not the mailbox:

- **What it stores:** for each recipient facility, a commitment pair —
  `sha256` of the facility's ML-KEM-1024 public key and `sha256` of its
  ML-DSA-signed recipient card — plus an append-only list of referral
  receipts (sender, recipient, `sha256` of the sealed envelope, `sha256`
  of the plaintext document, consent-id hash, timestamp).
- **What it never stores:** no medical data, no plaintext, no ciphertext
  payloads, no private key material. The QoreSeal envelope itself (hybrid
  ML-KEM-1024 + X25519) travels off-chain from clinic to facility.
- **Key registration:** the recipients' ML-KEM-1024 public keys themselves
  (1568 bytes, algorithmId 2) are registered on-chain in QoreChain's native
  PQC KEM registry; this EVM contract stores the sha256 commitment to that
  key, and the recipient-card commitment binds the KEM + X25519 keys to the
  facility's QoreChain account.
- **Live state at preparation time:** `receiptsCount() = 10`, two active
  recipient facilities registered (the second onboarded end-to-end on
  2026-11-19). All referral documents ever logged are fictional test data,
  labelled as such in the documents themselves.
- **Access model:** there is no owner, admin, or privileged role, and the
  contract holds no funds, makes no external calls, and is not upgradeable.
  Every recipient write is keyed by `msg.sender`, so a facility can only
  create, rotate, or revoke **its own** entry. `logReferral` is
  permissionless but rejects zero hashes and any recipient that is not
  registered and active.

## Honest design limits (stated so findings can be triaged against them)

1. **The 5 earliest receipts (ids 0–4) cannot be re-opened by the team.**
   They were sealed to the first facility's demo seal keys, which were held
   in memory only during the original run and are no longer available. The
   on-chain receipts themselves remain valid, immutable hash records; what
   is lost is only the team's ability to decrypt those five envelopes
   again. Receipts 5–9 (second facility) are unaffected.
2. **Consent verification is off-chain by design.** The patient's
   ML-DSA-87 consent signature is verified in the client (`src-core`)
   before `logReferral` is called; the contract stores only the consent-id
   hash and does not itself call the `pqcVerify` precompile. A caller could
   therefore log a receipt citing a consent id that was never signed — the
   registry proves *that a receipt was logged*, and the consent proof lives
   in the off-chain verification step. This is a known, accepted boundary
   of the hash-only design, not an oversight.
3. **Confidentiality does not come from this contract.** It comes from the
   off-chain QoreSeal layer (ML-KEM-1024 + X25519). This contract's job is
   integrity and non-repudiation of the referral log.
4. **QCAI is a static, AI-assisted review** (the dashboard itself states it
   does not compile, run, or runtime-test the contract). It complements —
   never replaces — the local Hardhat suite (12 contract tests) and the
   on-chain evidence in `deployments.testnet.json`.
