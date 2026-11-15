import { useMemo, useState } from "react";
import {
  buildReceipt,
  cardCommitment,
  createFacilityIdentity,
  createPatientKey,
  createRecipientCard,
  facilityIdentityFromSeed,
  kemKeyCommitment,
  openRecipient,
  openReferral,
  sealReferral,
  signConsent,
  verifyConsent,
  type PatientConsent,
  type RecipientCard,
  type ReferralDocument,
  type ReferralReceipt,
  type SealedReferral,
  type VerifiedRecipient,
} from "./core";
import { readReceiptsCountOnChain, registryAddressFromEnv } from "./chain";

/**
 * SealedMed Referral — frontend (LOCAL DEMO MODE with REAL cryptography).
 *
 * Unlike a mock, every cryptographic step on this page is real and runs
 * entirely in the browser, using the project's shared `src-core` module:
 *   - recipient cards are signed and verified with QoreSign hybrid
 *     signatures (secp256k1 + ML-DSA-87) from `@qorechain/qoresign`,
 *   - documents are sealed/opened with QoreSeal (`@qorechain/qoreseal`,
 *     ML-KEM-1024 + X25519 hybrid, AES-256-GCM, bound to chain id
 *     `qorechain-diana` and purpose `sealedmed-referral`),
 *   - patient consent is a real ML-DSA-87 signature (`@qorechain/pqc`).
 *
 * What is simulated is only the *transport*: in production the recipient's
 * registered keys are read from the chain (native KEM registry) and the
 * receipt is written to `SealedMedRegistry` on Diana; here the demo passes
 * the doctor's keys directly, as if read from chain, and renders the
 * receipt instead of sending the transaction. No data leaves the browser.
 * All patient data on this page is FICTIONAL.
 */

type Role = "doctor" | "clinic" | "patient";

const FICTIONAL_DOC: ReferralDocument = {
  patientAlias: "FICTIONAL Patient-001",
  referringFacility: "Fictional Health Clinic, Jakarta",
  receivingFacility: "Fictional Referral Hospital, Jakarta",
  reason: "Follow-up hypertension control referral (fictional case for demo purposes).",
  labSummary: "Hb 13.1 g/dL; random blood glucose 118 mg/dL; creatinine 0.9 mg/dL — all values are fictional.",
  createdAt: "2026-11-15T00:00:00Z",
};

const short = (s: string, n = 18) => (s.length > n * 2 + 3 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

export default function App() {
  // Deterministic fictional doctor (stable across reloads); clinic + patient are fresh per session.
  const doctor = useMemo(() => facilityIdentityFromSeed(new Uint8Array(32).fill(7)), []);
  const clinic = useMemo(() => createFacilityIdentity(), []);
  const patientKey = useMemo(() => createPatientKey(), []);
  const patientAddress = "qor1patientfictional000000000000000000000";

  const [role, setRole] = useState<Role>("doctor");
  const [card, setCard] = useState<RecipientCard | null>(null);
  const [verified, setVerified] = useState<VerifiedRecipient | null>(null);
  const [doc, setDoc] = useState<ReferralDocument>(FICTIONAL_DOC);
  const [sealed, setSealed] = useState<SealedReferral | null>(null);
  const [consent, setConsent] = useState<PatientConsent | null>(null);
  const [consentOk, setConsentOk] = useState<boolean | null>(null);
  const [receipt, setReceipt] = useState<ReferralReceipt | null>(null);
  const [opened, setOpened] = useState<ReferralDocument | null>(null);
  const [notice, setNotice] = useState<string>("Start with the Receiving Doctor role: create a recipient card.");
  const [chainInfo, setChainInfo] = useState<string>("");

  const registryAddress = registryAddressFromEnv();

  function makeCard() {
    const c = createRecipientCard(doctor);
    setCard(c);
    setVerified(null);
    setNotice("Recipient card created and signed with ML-DSA-87 + secp256k1 (QoreSign). Now verify the card.");
  }

  function verifyCard() {
    if (!card) return;
    try {
      // In production these two keys are read from the chain for the doctor's
      // account; the demo passes the same values directly (see header note).
      const v = openRecipient({
        card,
        registeredPqPublicKey: doctor.pqKey.publicKey,
        registeredMlkemPublicKey: doctor.sealKeys.mlkemPublicKey,
      });
      setVerified(v);
      setNotice("Card VERIFIED: the X25519 + ML-KEM keys are bound to the doctor's account by an ML-DSA-87 signature. The clinic may now encrypt.");
    } catch (e) {
      setNotice(`Card REJECTED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function doSeal() {
    if (!verified) return;
    const s = sealReferral({ doc, to: verified });
    setSealed(s);
    setConsent(null);
    setConsentOk(null);
    setReceipt(null);
    setOpened(null);
    setNotice("Document ENCRYPTED in the clinic's browser (QoreSeal hybrid ML-KEM-1024 + X25519). The envelope is ready to be sent off-chain; now request the patient's consent.");
    setRole("patient");
  }

  function doConsent() {
    if (!sealed) return;
    const c = signConsent({
      patientKey,
      patientAddress,
      senderAddress: clinic.address,
      recipientAddress: doctor.address,
      docHash: sealed.docHash,
      envelopeHash: sealed.envelopeHash,
    });
    const ok = verifyConsent(c, {
      docHash: sealed.docHash,
      envelopeHash: sealed.envelopeHash,
      senderAddress: clinic.address,
      recipientAddress: doctor.address,
    });
    setConsent(c);
    setConsentOk(ok);
    if (ok) {
      const r = buildReceipt({ senderAddress: clinic.address, verified: verified!, sealed, consent: c });
      setReceipt(r);
      setNotice("Patient consent VALID (ML-DSA-87 signature verified and bound to this envelope). The hash-only receipt is ready to be recorded on-chain.");
    } else {
      setNotice("Consent NOT valid — no receipt was created.");
    }
    setRole("clinic");
  }

  function doOpen(asStranger: boolean) {
    if (!sealed) return;
    try {
      const keys = asStranger ? createFacilityIdentity().sealKeys : doctor.sealKeys;
      const d = openReferral({ envelope: sealed.envelope, keys });
      setOpened(d);
      setNotice("Envelope OPENED by the receiving doctor. The plaintext appears only on the doctor's device.");
    } catch (e) {
      setOpened(null);
      setNotice(
        asStranger
          ? `A stranger FAILED to open it (by design): ${e instanceof Error ? e.message : String(e)}`
          : `Failed to open: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function checkChain() {
    if (!registryAddress) return;
    try {
      const n = await readReceiptsCountOnChain(registryAddress);
      setChainInfo(`Registry on Diana: ${n.toString()} receipts recorded on-chain.`);
    } catch (e) {
      setChainInfo(`Failed to read the chain: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="page">
      <header>
        <h1>SealedMed Referral</h1>
        <p className="tagline">
          Confidential medical referrals &amp; lab results between healthcare facilities — encrypted with ML-KEM-1024 in
          the browser, bound by ML-DSA-87, with a hash-only receipt on QoreChain.
        </p>
        <p className="fiction">⚠ All patient data on this page is FICTIONAL, created for demo purposes. Never enter real medical data.</p>
        <p className="notice">{notice}</p>
      </header>

      <nav className="roles">
        {(["doctor", "clinic", "patient"] as Role[]).map((r) => (
          <button key={r} className={role === r ? "active" : ""} onClick={() => setRole(r)}>
            {r === "doctor" ? "1 · Receiving Doctor" : r === "clinic" ? "2 · Sending Clinic" : "3 · Patient"}
          </button>
        ))}
      </nav>

      {role === "doctor" && (
        <section>
          <h2>Receiving Doctor — recipient keys</h2>
          <dl>
            <dt>QoreChain account</dt>
            <dd>{doctor.address}</dd>
            <dt>ML-KEM-1024 key (1568 bytes, registered on-chain)</dt>
            <dd>sha256 commitment: {kemKeyCommitment(doctor.sealKeys.mlkemPublicKey)}</dd>
          </dl>
          <div className="row">
            <button onClick={makeCard}>Create &amp; sign Recipient Card (ML-DSA)</button>
            <button onClick={verifyCard} disabled={!card}>
              Verify Card
            </button>
          </div>
          {card && (
            <div className="card">
              <p>
                <strong>Recipient card</strong> — cardHash (on-chain commitment): {cardCommitment(card)}
              </p>
              <p className="mono">{short(JSON.stringify(card), 60)}</p>
              {verified ? <p className="ok">✔ Card verified against the doctor's registered keys.</p> : <p>Not yet verified.</p>}
            </div>
          )}
          <h3>Open an incoming referral</h3>
          {!sealed && <p>No envelope yet. Ask the clinic to encrypt one first.</p>}
          {sealed && (
            <div className="row">
              <button onClick={() => doOpen(false)}>Open Envelope (as the receiving doctor)</button>
              <button onClick={() => doOpen(true)}>Try opening as a stranger</button>
            </div>
          )}
          {opened && (
            <div className="card">
              <p>
                <strong>Opened document (on this device only):</strong>
              </p>
              <pre>{JSON.stringify(opened, null, 2)}</pre>
            </div>
          )}
        </section>
      )}

      {role === "clinic" && (
        <section>
          <h2>Sending Clinic — referral document (FICTIONAL)</h2>
          <label>
            Referral reason
            <textarea value={doc.reason} onChange={(e) => setDoc({ ...doc, reason: e.target.value })} rows={2} />
          </label>
          <label>
            Lab summary
            <textarea value={doc.labSummary} onChange={(e) => setDoc({ ...doc, labSummary: e.target.value })} rows={2} />
          </label>
          <button onClick={doSeal} disabled={!verified}>
            Encrypt &amp; Seal to the Receiving Doctor (QoreSeal hybrid)
          </button>
          {!verified && <p>The doctor's card must be verified first (Receiving Doctor role).</p>}
          {sealed && (
            <div className="card">
              <p>
                <strong>Envelope (off-chain transport):</strong>
              </p>
              <p className="mono">{short(sealed.envelopeText, 70)}</p>
              <p>envelopeHash: {sealed.envelopeHash}</p>
              <p>docHash (plaintext commitment): {sealed.docHash}</p>
            </div>
          )}
          {receipt && (
            <div className="card">
              <p>
                <strong>Receipt recorded on-chain</strong> (SealedMedRegistry.logReferral — hashes &amp; public metadata only):
              </p>
              <pre>{JSON.stringify(receipt, null, 2)}</pre>
              <p className="mono">
                On Diana, this call uses the EVM (coin-60) addresses of both facilities; the qor1 addresses above are the
                native form of the same accounts.
              </p>
            </div>
          )}
        </section>
      )}

      {role === "patient" && (
        <section>
          <h2>Patient — ML-DSA-87 consent</h2>
          <p>
            This consent signs the document hash + envelope hash + both facilities, and is valid for 1 hour. The signature
            is made with the patient's ML-DSA-87 key (local demo — in production from QoreX/SDK with the key registered
            on-chain).
          </p>
          {sealed ? (
            <>
              <p>docHash: {sealed.docHash}</p>
              <p>envelopeHash: {sealed.envelopeHash}</p>
              <button onClick={doConsent}>Sign Consent (ML-DSA-87)</button>
            </>
          ) : (
            <p>No envelope from the clinic yet.</p>
          )}
          {consent && (
            <p className={consentOk ? "ok" : "bad"}>
              Consent {consentOk ? "VALID ✔" : "NOT VALID ✘"} — id {consent.consentId}
            </p>
          )}
        </section>
      )}

      <footer>
        <p>
          Chain: <strong>qorechain-diana</strong> · Purpose: <strong>sealedmed-referral</strong> · Encryption/decryption
          is 100% client-side — no server ever sees the plaintext.
        </p>
        {registryAddress ? (
          <p>
            Registry: {registryAddress} <button onClick={checkChain}>Read on-chain receipt count</button> {chainInfo}
          </p>
        ) : (
          <p>
            This demo runs fully locally and does not connect to the on-chain registry (deployed on Diana — see the
            repository README). Set <code>VITE_REGISTRY_ADDRESS</code> to read the registry directly from Diana.
          </p>
        )}
      </footer>
    </div>
  );
}
