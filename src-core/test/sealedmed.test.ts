import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAIN_ID,
  PURPOSE,
  buildReceipt,
  cardCommitment,
  createFacilityIdentity,
  createPatientKey,
  createRecipientCard,
  envelopeFromText,
  facilityIdentityFromSeed,
  kemKeyCommitment,
  openReferral,
  openRecipient,
  sealReferral,
  signConsent,
  verifyConsent,
  type ReferralDocument,
} from "../index.js";

/** FICTIONAL demo document — not a real patient. */
const DOC: ReferralDocument = {
  patientAlias: "Pasien FIKSI-001",
  referringFacility: "Klinik Sehat Fiksi, Jakarta",
  receivingFacility: "RS Rujukan Fiksi, Jakarta",
  reason: "Rujukan kontrol lanjutan (kasus fiksi untuk demo).",
  labSummary: "Hb 13.1 g/dL; GDS 118 mg/dL — semua nilai fiksi.",
  createdAt: "2026-11-15T00:00:00Z",
};

function setup() {
  const doctor = facilityIdentityFromSeed(new Uint8Array(32).fill(7));
  const clinic = createFacilityIdentity();
  const card = createRecipientCard(doctor);
  const verified = openRecipient({
    card,
    registeredPqPublicKey: doctor.pqKey.publicKey,
    registeredMlkemPublicKey: doctor.sealKeys.mlkemPublicKey,
  });
  return { doctor, clinic, card, verified };
}

describe("SealedMed core crypto (real @qorechain/qoreseal + @qorechain/pqc)", () => {
  it("facility identity is deterministic from a seed and complete", () => {
    const a = facilityIdentityFromSeed(new Uint8Array(32).fill(3));
    const b = facilityIdentityFromSeed(new Uint8Array(32).fill(3));
    assert.equal(a.address, b.address);
    assert.ok(a.address.startsWith("qor1"));
    assert.equal(a.sealKeys.mlkemPublicKey.length, 1568);
    assert.equal(a.pqKey.publicKey.length, 2592);
  });

  it("recipient card commitments are stable and bound to the keys", () => {
    const { doctor, card } = setup();
    assert.equal(kemKeyCommitment(doctor.sealKeys.mlkemPublicKey).length, 66);
    assert.equal(cardCommitment(card).length, 66);
    assert.equal(card.address, doctor.address);
    assert.equal(card.chainId, CHAIN_ID);
  });

  it("seal -> open roundtrip returns the exact document", () => {
    const { doctor, verified } = setup();
    const sealed = sealReferral({ doc: DOC, to: verified });
    assert.ok(sealed.envelopeText.startsWith("qoreseal:"));
    assert.equal(sealed.envelopeHash.length, 66);
    const opened = openReferral({ envelope: sealed.envelope, keys: doctor.sealKeys });
    assert.deepEqual(opened, DOC);
  });

  it("envelope survives the text transport form", () => {
    const { doctor, verified } = setup();
    const sealed = sealReferral({ doc: DOC, to: verified });
    const bytes = envelopeFromText(sealed.envelopeText);
    assert.deepEqual(openReferral({ envelope: bytes, keys: doctor.sealKeys }), DOC);
  });

  it("NEGATIVE: opening with the wrong facility keys fails", () => {
    const { verified } = setup();
    const stranger = createFacilityIdentity();
    const sealed = sealReferral({ doc: DOC, to: verified });
    assert.throws(() => openReferral({ envelope: sealed.envelope, keys: stranger.sealKeys }));
  });

  it("NEGATIVE: opening under a wrong purpose fails", () => {
    const { doctor, verified } = setup();
    const sealed = sealReferral({ doc: DOC, to: verified });
    assert.throws(() =>
      openReferral({ envelope: sealed.envelope, keys: doctor.sealKeys, purpose: "invoice" }),
    );
  });

  it("NEGATIVE: opening under a wrong chainId fails", () => {
    const { doctor, verified } = setup();
    const sealed = sealReferral({ doc: DOC, to: verified });
    assert.throws(() =>
      openReferral({ envelope: sealed.envelope, keys: doctor.sealKeys, chainId: "qorechain-vladi" }),
    );
  });

  it("NEGATIVE: a tampered envelope fails (GCM authentication)", () => {
    const { doctor, verified } = setup();
    const sealed = sealReferral({ doc: DOC, to: verified });
    const tampered = new Uint8Array(sealed.envelope);
    tampered[tampered.length - 1] ^= 0x01;
    assert.throws(() => openReferral({ envelope: tampered, keys: doctor.sealKeys }));
    const tamperedHead = new Uint8Array(sealed.envelope);
    tamperedHead[10] ^= 0x40;
    assert.throws(() => openReferral({ envelope: tamperedHead, keys: doctor.sealKeys }));
  });

  it("NEGATIVE: a recipient card with a forged signature is rejected", () => {
    const { doctor, card } = setup();
    const forged = structuredClone(card);
    // Corrupt the ML-DSA part of the hybrid signature.
    const sigBytes = Buffer.from(forged.signature.pq!.signature, "base64");
    sigBytes[0] ^= 0xff;
    forged.signature.pq!.signature = sigBytes.toString("base64");
    assert.throws(() =>
      openRecipient({
        card: forged,
        registeredPqPublicKey: doctor.pqKey.publicKey,
        registeredMlkemPublicKey: doctor.sealKeys.mlkemPublicKey,
      }),
    );
  });

  it("NEGATIVE: a card whose X25519 key was swapped is rejected", () => {
    const { doctor, card } = setup();
    const attacker = createFacilityIdentity();
    const swapped = { ...card, x25519PublicKey: Buffer.from(attacker.sealKeys.x25519PublicKey).toString("hex") };
    assert.throws(() =>
      openRecipient({
        card: swapped,
        registeredPqPublicKey: doctor.pqKey.publicKey,
        registeredMlkemPublicKey: doctor.sealKeys.mlkemPublicKey,
      }),
    );
  });

  it("NEGATIVE: a card verified against a different registered ML-KEM key is rejected", () => {
    const { card } = setup();
    const other = createFacilityIdentity();
    assert.throws(() =>
      openRecipient({
        card,
        registeredPqPublicKey: other.pqKey.publicKey,
        registeredMlkemPublicKey: other.sealKeys.mlkemPublicKey,
      }),
    );
  });

  it("patient consent verifies for the exact referral it was issued for", () => {
    const { clinic, doctor, verified } = setup();
    const sealed = sealReferral({ doc: DOC, to: verified });
    const patientKey = createPatientKey(new Uint8Array(32).fill(11));
    const consent = signConsent({
      patientKey,
      patientAddress: "qor1patientfictional000000000000000000000",
      senderAddress: clinic.address,
      recipientAddress: doctor.address,
      docHash: sealed.docHash,
      envelopeHash: sealed.envelopeHash,
      nowSeconds: 1_800_000_000,
    });
    assert.equal(
      verifyConsent(
        consent,
        {
          docHash: sealed.docHash,
          envelopeHash: sealed.envelopeHash,
          senderAddress: clinic.address,
          recipientAddress: doctor.address,
        },
        1_800_000_100,
      ),
      true,
    );
    const receipt = buildReceipt({ senderAddress: clinic.address, verified, sealed, consent });
    assert.equal(receipt.envelopeHash, sealed.envelopeHash);
    assert.equal(receipt.consentIdHash.length, 66);
  });

  it("NEGATIVE: a forged consent signature is rejected", () => {
    const { clinic, doctor, verified } = setup();
    const sealed = sealReferral({ doc: DOC, to: verified });
    const patientKey = createPatientKey(new Uint8Array(32).fill(12));
    const consent = signConsent({
      patientKey,
      patientAddress: "qor1patientfictional000000000000000000000",
      senderAddress: clinic.address,
      recipientAddress: doctor.address,
      docHash: sealed.docHash,
      envelopeHash: sealed.envelopeHash,
      nowSeconds: 1_800_000_000,
    });
    // Flip the first signature byte deterministically: ML-DSA-87 signing is
    // randomised, so a fixed "ff" replacement is a no-op (and the test fails)
    // whenever the first byte already happens to be 0xff (1/256 per run).
    const firstByte = consent.signature.slice(0, 2);
    const forgedSig = (firstByte === "ff" ? "00" : "ff") + consent.signature.slice(2);
    assert.notEqual(forgedSig, consent.signature);
    const forged = { ...consent, signature: forgedSig };
    assert.equal(
      verifyConsent(
        forged,
        {
          docHash: sealed.docHash,
          envelopeHash: sealed.envelopeHash,
          senderAddress: clinic.address,
          recipientAddress: doctor.address,
        },
        1_800_000_100,
      ),
      false,
    );
  });

  it("NEGATIVE: an expired consent is rejected, and a consent bound to another referral is rejected", () => {
    const { clinic, doctor, verified } = setup();
    const sealed = sealReferral({ doc: DOC, to: verified });
    const patientKey = createPatientKey(new Uint8Array(32).fill(13));
    const consent = signConsent({
      patientKey,
      patientAddress: "qor1patientfictional000000000000000000000",
      senderAddress: clinic.address,
      recipientAddress: doctor.address,
      docHash: sealed.docHash,
      envelopeHash: sealed.envelopeHash,
      ttlSeconds: 60,
      nowSeconds: 1_800_000_000,
    });
    const expected = {
      docHash: sealed.docHash,
      envelopeHash: sealed.envelopeHash,
      senderAddress: clinic.address,
      recipientAddress: doctor.address,
    };
    assert.equal(verifyConsent(consent, expected, 1_800_000_061), false); // expired
    assert.equal(
      verifyConsent(consent, { ...expected, docHash: "0x" + "00".repeat(32) }, 1_800_000_010),
      false,
    ); // bound to a different document
  });

  it("the purpose and chain constants are the production binding values", () => {
    assert.equal(PURPOSE, "sealedmed-referral");
    assert.equal(CHAIN_ID, "qorechain-diana");
  });
});
