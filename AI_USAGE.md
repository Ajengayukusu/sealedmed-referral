# AI_USAGE.md — SealedMed Referral

*Documentation for the Best AI-Native Build special award: what the AI did,
what the human decided, and how every AI-generated artefact was verified.*

## Human (Ajeng Ayu Kusuma) — direction & decisions

- Chose the problem space: confidential medical referrals and lab results
  between Indonesian healthcare facilities, and the Encrypted Apps category.
- Set the non-negotiable quality bar: 10/10, no basic/template submissions,
  enter to win — and the product constraints this repo encodes: encryption
  must happen client-side only, the chain may store hashes and receipts but
  never medical data, patient consent must be a post-quantum signature, and
  no real patient data may ever be used (fictional demo data only).
- Decided the work order: solo categories first, team category later.
- Owns all accounts, keys and submissions: GitHub, X, QoreX (testnet) and
  the contest registration are the human's; no AI ever holds a recovery
  phrase or a private key belonging to the human.
- Decides go/no-go at each phase gate (research → foundation spike → build
  → deploy → submit).

## AI agent (Mica / Muse) — research, engineering & documentation

### Research phase (all claims verified against live sources)
- Read the full fest site (rules, kits, start, about) and the fest docs on
  docs.qorechain.io; cross-checked the Encrypted Apps requirements against
  the live chain (KEM registry parameters, SDK/QoreSeal versions on npm).
- Analysed competitor projects in the category to find the quality bar and
  the unsaturated angle: health data as the strongest
  *harvest-now-decrypt-later* case, instead of another generic messenger.
- Verified the KEM-registry facts in the strategy file against the actual
  installed packages before writing code (algorithmId 2, 1568-byte keys,
  SDK-alone-does-not-encrypt).

### Build phase (this repository)
- **Read the real package surfaces before writing any crypto code**:
  inspected `@qorechain/qoreseal` 0.1.0's shipped `.d.ts` files and ran its
  functions, and did the same for `@qorechain/qoresign` 0.1.0 and
  `@qorechain/pqc` 0.2.3. Two brief assumptions turned out wrong and were
  corrected from the packages, not guessed around:
  (1) `@qorechain/pqc` exposes `mldsa87.{keygen,sign,verify}` (not a bare
  `mldsa.sign` in the assumed shape), and (2) QoreSeal already ships the
  canonical recipient-card machinery (`signRecipientCard` /
  `verifyRecipientCard` over QoreSign hybrid signatures) — so SealedMed
  uses the ecosystem format instead of an invented card scheme.
- Wrote `src-core/` as one shared TypeScript module (facility identities,
  recipient cards + verification, seal/open, ML-DSA patient consent,
  receipts) imported by **both** the test suite and the React frontend, so
  the demo provably runs the tested code.
- Wrote `SealedMedRegistry.sol` (hash-only commitments + append-only
  receipts, registration/rotation/revocation rules) and its 12-test suite.
- Wrote the 15-case crypto suite, deliberately negative-first: wrong keys,
  wrong purpose, wrong chain id, bit-flipped envelope (head and tail),
  forged card signature, swapped card X25519 key, card checked against a
  different registered KEM key, forged consent signature, expired consent,
  consent replayed against a different referral.
- Built the 3-role Vite/React demo in which every cryptographic operation
  is the real package code running in the browser (no mock crypto), plus
  the optional Diana read layer via `@qorechain/evm` (`qorechainTestnet` +
  viem `readContract`), gated behind `VITE_REGISTRY_ADDRESS`.
- Wrote `scripts/register-kem-key.ts` from the SDK's verified surface
  (`ensurePqcRegistered` → `msg.pqc.registerKemKey` → `fetchKemKey`), and
  `scripts/deploy.ts` with the bootstrap prerequisites and a hard Diana
  chain-id guard.
- Drafted the README (judge path, requirement → evidence table, threat
  model, honest limits) — including limits inherited from QoreSeal itself
  (unsigned envelopes, public metadata, seed loss = data loss, pre-1.0
  pending external review) rather than marketing around them.

### Verification of AI output (nothing shipped unverified)
- `npm run test:core` — **15 passing, 0 failing** (node:test, real packages).
- `npx hardhat test` — **12 passing, 0 failing** (solc 0.8.24).
- `npx tsc -p tsconfig.core.json --noEmit` — clean (core + KEM script
  typecheck against the installed SDK 0.14.0 types; one API mismatch the
  compiler caught — `EnsurePqcRegisteredResult.txHash` — was fixed from
  the SDK's own type definitions).
- `cd frontend && npm run build` — clean (tsc + vite production build;
  549 modules, the real QoreSeal/QoreSign/PQC code bundled).
- The live phase has since been executed and verified on chain: the
  registry contract is deployed and the recipient KEM key is registered,
  with every live artefact recorded in `deployments.testnet.json` and the
  README — nothing was written down before it was proven on chain.

## Division of labour, in one line

The human picked the fight, the rules of engagement and owns the keys;
the AI did the research, engineering and paperwork — and every claim it
produced was checked against the packages, the compiler or the test runner
before it was written down.
