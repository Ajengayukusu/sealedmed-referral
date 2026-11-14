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
  patientAlias: "Pasien FIKSI-001",
  referringFacility: "Klinik Sehat Fiksi, Jakarta",
  receivingFacility: "RS Rujukan Fiksi, Jakarta",
  reason: "Rujukan kontrol lanjutan hipertensi (kasus fiksi untuk demo).",
  labSummary: "Hb 13,1 g/dL; GDS 118 mg/dL; kreatinin 0,9 mg/dL — semua nilai fiksi.",
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
  const [notice, setNotice] = useState<string>("Mulai dari peran Dokter Tujuan: buat recipient card.");
  const [chainInfo, setChainInfo] = useState<string>("");

  const registryAddress = registryAddressFromEnv();

  function makeCard() {
    const c = createRecipientCard(doctor);
    setCard(c);
    setVerified(null);
    setNotice("Recipient card dibuat dan ditandatangani ML-DSA-87 + secp256k1 (QoreSign). Sekarang verifikasi card-nya.");
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
      setNotice("Card TERVERIFIKASI: kunci X25519 + ML-KEM terikat ke akun dokter oleh signature ML-DSA-87. Klinik sekarang boleh mengenkripsi.");
    } catch (e) {
      setNotice(`Card DITOLAK: ${e instanceof Error ? e.message : String(e)}`);
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
    setNotice("Dokumen TERENKRIPSI di browser klinik (QoreSeal hybrid ML-KEM-1024 + X25519). Envelope siap dikirim off-chain; sekarang minta consent pasien.");
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
      setNotice("Consent pasien VALID (signature ML-DSA-87 terverifikasi + terikat ke envelope ini). Receipt hash-only siap dicatat on-chain.");
    } else {
      setNotice("Consent TIDAK valid — receipt tidak dibuat.");
    }
    setRole("clinic");
  }

  function doOpen(asStranger: boolean) {
    if (!sealed) return;
    try {
      const keys = asStranger ? createFacilityIdentity().sealKeys : doctor.sealKeys;
      const d = openReferral({ envelope: sealed.envelope, keys });
      setOpened(d);
      setNotice("Envelope TERBUKA oleh dokter tujuan. Plaintext hanya muncul di perangkat dokter.");
    } catch (e) {
      setOpened(null);
      setNotice(
        asStranger
          ? `Orang asing GAGAL membuka (sesuai desain): ${e instanceof Error ? e.message : String(e)}`
          : `Gagal membuka: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function checkChain() {
    if (!registryAddress) return;
    try {
      const n = await readReceiptsCountOnChain(registryAddress);
      setChainInfo(`Registry di Diana: ${n.toString()} receipt tercatat on-chain.`);
    } catch (e) {
      setChainInfo(`Gagal membaca chain: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="page">
      <header>
        <h1>SealedMed Referral</h1>
        <p className="tagline">
          Rujukan medis &amp; hasil lab rahasia antar-faskes — terenkripsi ML-KEM-1024 di browser,
          terikat ML-DSA-87, receipt hash-only di QoreChain.
        </p>
        <p className="fiction">⚠ Semua data pasien di halaman ini FIKSI, dibuat untuk demo. Jangan pernah memasukkan data medis asli.</p>
        <p className="notice">{notice}</p>
      </header>

      <nav className="roles">
        {(["doctor", "clinic", "patient"] as Role[]).map((r) => (
          <button key={r} className={role === r ? "active" : ""} onClick={() => setRole(r)}>
            {r === "doctor" ? "1 · Dokter Tujuan" : r === "clinic" ? "2 · Klinik Pengirim" : "3 · Pasien"}
          </button>
        ))}
      </nav>

      {role === "doctor" && (
        <section>
          <h2>Dokter Tujuan — kunci penerima</h2>
          <dl>
            <dt>Akun QoreChain</dt>
            <dd>{doctor.address}</dd>
            <dt>ML-KEM-1024 key (1568 byte, didaftarkan on-chain)</dt>
            <dd>komitmen sha256: {kemKeyCommitment(doctor.sealKeys.mlkemPublicKey)}</dd>
          </dl>
          <div className="row">
            <button onClick={makeCard}>Buat &amp; tanda tangani Recipient Card (ML-DSA)</button>
            <button onClick={verifyCard} disabled={!card}>
              Verifikasi Card
            </button>
          </div>
          {card && (
            <div className="card">
              <p>
                <strong>Recipient card</strong> — cardHash (komitmen on-chain): {cardCommitment(card)}
              </p>
              <p className="mono">{short(JSON.stringify(card), 60)}</p>
              {verified ? <p className="ok">✔ Card terverifikasi terhadap kunci terdaftar dokter.</p> : <p>Belum terverifikasi.</p>}
            </div>
          )}
          <h3>Buka rujukan masuk</h3>
          {!sealed && <p>Belum ada envelope. Minta klinik mengenkripsi dulu.</p>}
          {sealed && (
            <div className="row">
              <button onClick={() => doOpen(false)}>Buka Envelope (sebagai dokter tujuan)</button>
              <button onClick={() => doOpen(true)}>Coba buka sebagai orang asing</button>
            </div>
          )}
          {opened && (
            <div className="card">
              <p>
                <strong>Dokumen terbuka (hanya di perangkat ini):</strong>
              </p>
              <pre>{JSON.stringify(opened, null, 2)}</pre>
            </div>
          )}
        </section>
      )}

      {role === "clinic" && (
        <section>
          <h2>Klinik Pengirim — dokumen rujukan (FIKSI)</h2>
          <label>
            Alasan rujukan
            <textarea value={doc.reason} onChange={(e) => setDoc({ ...doc, reason: e.target.value })} rows={2} />
          </label>
          <label>
            Ringkasan lab
            <textarea value={doc.labSummary} onChange={(e) => setDoc({ ...doc, labSummary: e.target.value })} rows={2} />
          </label>
          <button onClick={doSeal} disabled={!verified}>
            Enkripsi &amp; Seal ke Dokter Tujuan (QoreSeal hybrid)
          </button>
          {!verified && <p>Card dokter harus terverifikasi dulu (peran Dokter Tujuan).</p>}
          {sealed && (
            <div className="card">
              <p>
                <strong>Envelope (transport off-chain):</strong>
              </p>
              <p className="mono">{short(sealed.envelopeText, 70)}</p>
              <p>envelopeHash: {sealed.envelopeHash}</p>
              <p>docHash (komitmen plaintext): {sealed.docHash}</p>
            </div>
          )}
          {receipt && (
            <div className="card">
              <p>
                <strong>Receipt yang dicatat on-chain</strong> (SealedMedRegistry.logReferral — hanya hash &amp; metadata publik):
              </p>
              <pre>{JSON.stringify(receipt, null, 2)}</pre>
              <p className="mono">
                Di Diana, pemanggilan ini memakai alamat EVM (coin-60) kedua faskes; alamat qor1 di atas adalah bentuk native
                dari akun yang sama.
              </p>
            </div>
          )}
        </section>
      )}

      {role === "patient" && (
        <section>
          <h2>Pasien — consent ML-DSA-87</h2>
          <p>
            Consent ini menandatangani hash dokumen + hash envelope + kedua faskes, berlaku 1 jam. Signature dibuat dengan
            kunci ML-DSA-87 pasien (demo lokal — di produksi dari QoreX/SDK dengan kunci yang terdaftar on-chain).
          </p>
          {sealed ? (
            <>
              <p>docHash: {sealed.docHash}</p>
              <p>envelopeHash: {sealed.envelopeHash}</p>
              <button onClick={doConsent}>Tanda tangani Consent (ML-DSA-87)</button>
            </>
          ) : (
            <p>Belum ada envelope dari klinik.</p>
          )}
          {consent && (
            <p className={consentOk ? "ok" : "bad"}>
              Consent {consentOk ? "VALID ✔" : "TIDAK VALID ✘"} — id {consent.consentId}
            </p>
          )}
        </section>
      )}

      <footer>
        <p>
          Chain: <strong>qorechain-diana</strong> · Purpose: <strong>sealedmed-referral</strong> · Enkripsi/dekripsi 100%
          client-side — tidak ada server yang melihat plaintext.
        </p>
        {registryAddress ? (
          <p>
            Registry: {registryAddress} <button onClick={checkChain}>Baca jumlah receipt on-chain</button> {chainInfo}
          </p>
        ) : (
          <p>
            Registry belum di-deploy (mode demo lokal penuh). Set <code>VITE_REGISTRY_ADDRESS</code> setelah deployment
            untuk membaca registry langsung dari Diana.
          </p>
        )}
      </footer>
    </div>
  );
}
