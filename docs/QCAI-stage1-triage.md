# QCAI Audit — SealedMedRegistry, Stage 1 Triage

- **Project:** SealedMed (`sealedmed-referral`)
- **Contract:** `SealedMedRegistry` (`contracts/SealedMedRegistry.sol`)
- **Deployed (Diana testnet):** `0x9aa1EF27d14F46e5Fbe399CE2402fDc0673b65C1`
- **Audit run:** 27 Nov 2026, 07:09 WIB (free daily run)
- **Report:** `docs/QCAI-audit-stage1.pdf` (generated 11/27/2026, 7:09:08 AM)
- **Source audited:** `flattened/SealedMedRegistry.flattened.sol` (152 lines, 6,755 bytes,
  byte-identical to the deployed source; Blockchain = QoreChain)

## Verified score (from PDF text, not from the browser display)

| Item | Value |
|---|---|
| Overall Security Score | **85/100** |
| Risk Level | MEDIUM |
| Quantum Readiness | QUANTUM-SAFE |
| Blockchain (PDF) | qorechain |
| Total findings | 4 (1 HIGH, 1 MEDIUM, 1 LOW, 1 INFO) |

Executive summary (PDF): the contract is a quantum-safe registry for medical
referrals using hash commitments of post-quantum keys; it correctly avoids
storing sensitive data on-chain and provides registration, update, and
revocation of recipients.

## Design context the triage relies on

`SealedMedRegistry` is a **hash-only registry** by design. It never stores
medical data, plaintext, or ciphertext payloads. For each recipient facility
it stores only two `sha256` commitments — of the facility's ML-KEM-1024 public
key and of its ML-DSA-signed recipient card — plus an append-only list of
referral receipts (hashes only). The actual ML-KEM-1024 public keys (1,568
bytes) live in QoreChain's native PQC KEM registry; the QoreSeal envelope
(hybrid ML-KEM-1024 + X25519) travels off-chain; the patient's ML-DSA-87
consent signature is verified in the client (`src-core`) before `logReferral`
is called. The contract holds no funds, makes no external calls, has no owner
or admin role, and is not upgradeable. Every recipient write is keyed by
`msg.sender`, so a facility can only write its own entry.

## Triage

| # | Finding (severity) | Location (PDF) | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Inconsistent Post-Quantum Algorithm Usage (HIGH) | contract SealedMedRegistry | **Accepted by design** | The contract never claims to execute PQC primitives on-chain: it stores `sha256` commitments to ML-KEM-1024 keys (`contracts/SealedMedRegistry.sol:18-19`) whose real keys live in QoreChain's native PQC KEM registry, and consent is verified off-chain in `src-core` before `logReferral` (see `flattened/README.md`). An EVM contract cannot run ML-KEM-1024 natively (no ML-KEM precompile; 1,568-byte keys), so "implement PQC libraries in the contract" is not an applicable fix — the hybrid split (native registry + off-chain QoreSeal + on-chain hash commitments) is the documented architecture. The finding's premise is factually true (no PQC code inside the contract) but it describes the intended design, not a defect. No code change. |
| 2 | Potential Reentrancy Risk via External Calls (MEDIUM) | function logReferral | **False positive** | `logReferral` (`contracts/SealedMedRegistry.sol:112-137`) makes **no external call at all** — no `.call`, `transfer`, `send`, or `delegatecall` anywhere in the contract (verified by grep). It only appends to `receipts` storage and emits `ReferralLogged`. With no external call there is no re-entry path; the finding is explicitly conditional ("could be vulnerable if external calls are made in future versions") and does not describe the current code. No code change. |
| 3 | Missing Input Validation for Address Parameters (LOW) | function logReferral | **False positive** | A zero recipient address cannot pass: `logReferral` reads `recipients[recipient]` and reverts `NotRegistered` when `registeredAt == 0` (`contracts/SealedMedRegistry.sol:121-122`). `address(0)` can never register, because `registerRecipient` keys the entry by `msg.sender` (`:65`), and `address(0)` can never be `msg.sender`. The zero-address case is therefore already rejected by the existing registration check. No code change. |
| 4 | Missing Documentation for Public Functions (INFO) | functions registerRecipient, updateRecipient, revokeRecipient | **False positive** | All three named functions already carry NatSpec `@notice` blocks in the audited source: `registerRecipient` (`contracts/SealedMedRegistry.sol:57-64`), `updateRecipient` (`:77-79`), `revokeRecipient` (`:91-95`); `logReferral` additionally has full `@param`/`@return` documentation (`:104-111`), and the contract has `@title`/`@notice` (`:4-15`). The documentation the finding asks for is present. No code change. |

## Result

- **0 real issues.** 3 false positives, 1 accepted by design.
- No contract code changes made. The contract is unchanged from the deployed
  source (commit `03e2537be512c6c4cb3a7e68426aef139ec5b98f` per
  `flattened/README.md`).
- Stage 1 score **85/100, MEDIUM, QUANTUM-SAFE** — the highest stage-1 score
  among the solo projects so far (Rescue Run 82, DeedLock 72, DCA Guardian 65).
  Scores are not directly comparable across runs (the analyzer's finding set
  varies per run), but no finding here requires a fix.
