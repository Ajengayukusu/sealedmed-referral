import { expect } from "chai";
import { ethers } from "hardhat";
import type { SealedMedRegistry } from "../typechain-types";

const H = (n: number) => ethers.keccak256(ethers.toUtf8Bytes(`hash-${n}`));

describe("SealedMedRegistry", function () {
  let registry: SealedMedRegistry;
  let clinic: any, doctor: any, otherDoctor: any, stranger: any;

  beforeEach(async () => {
    [clinic, doctor, otherDoctor, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("SealedMedRegistry");
    registry = await factory.deploy();
  });

  describe("recipient registration", function () {
    it("registers a recipient and stores both commitments", async () => {
      await expect(registry.connect(doctor).registerRecipient(H(1), H(2)))
        .to.emit(registry, "RecipientRegistered")
        .withArgs(doctor.address, H(1), H(2));
      const r = await registry.recipients(doctor.address);
      expect(r.kemKeyHash).to.equal(H(1));
      expect(r.cardHash).to.equal(H(2));
      expect(r.active).to.equal(true);
      expect(await registry.isActiveRecipient(doctor.address)).to.equal(true);
    });

    it("NEGATIVE: rejects zero hashes on registration", async () => {
      await expect(
        registry.connect(doctor).registerRecipient(ethers.ZeroHash, H(2)),
      ).to.be.revertedWithCustomError(registry, "ZeroHash");
      await expect(
        registry.connect(doctor).registerRecipient(H(1), ethers.ZeroHash),
      ).to.be.revertedWithCustomError(registry, "ZeroHash");
    });

    it("NEGATIVE: re-registering while active (silent overwrite) is rejected", async () => {
      await registry.connect(doctor).registerRecipient(H(1), H(2));
      await expect(
        registry.connect(doctor).registerRecipient(H(9), H(9)),
      ).to.be.revertedWithCustomError(registry, "AlreadyRegisteredUseUpdate");
      const r = await registry.recipients(doctor.address);
      expect(r.kemKeyHash).to.equal(H(1)); // original entry untouched
    });

    it("NEGATIVE: nobody can overwrite another facility's entry", async () => {
      await registry.connect(doctor).registerRecipient(H(1), H(2));
      // A stranger registering writes only their OWN entry...
      await registry.connect(stranger).registerRecipient(H(7), H(8));
      const docEntry = await registry.recipients(doctor.address);
      expect(docEntry.kemKeyHash).to.equal(H(1));
      expect(docEntry.cardHash).to.equal(H(2));
      // ...and update/revoke from a non-owner address touches nothing of the doctor's.
      await registry.connect(stranger).updateRecipient(H(5), H(6));
      await registry.connect(stranger).revokeRecipient();
      const after = await registry.recipients(doctor.address);
      expect(after.kemKeyHash).to.equal(H(1));
      expect(after.active).to.equal(true);
    });

    it("rotates keys through updateRecipient and emits the event", async () => {
      await registry.connect(doctor).registerRecipient(H(1), H(2));
      await expect(registry.connect(doctor).updateRecipient(H(3), H(4)))
        .to.emit(registry, "RecipientUpdated")
        .withArgs(doctor.address, H(3), H(4));
      const r = await registry.recipients(doctor.address);
      expect(r.kemKeyHash).to.equal(H(3));
      expect(r.cardHash).to.equal(H(4));
    });

    it("NEGATIVE: update before registration is rejected", async () => {
      await expect(registry.connect(doctor).updateRecipient(H(3), H(4))).to.be.revertedWithCustomError(
        registry,
        "NotRegistered",
      );
    });

    it("revokes, and a revoked recipient can re-register with a fresh key", async () => {
      await registry.connect(doctor).registerRecipient(H(1), H(2));
      await expect(registry.connect(doctor).revokeRecipient())
        .to.emit(registry, "RecipientRevoked")
        .withArgs(doctor.address);
      expect(await registry.isActiveRecipient(doctor.address)).to.equal(false);
      await registry.connect(doctor).registerRecipient(H(10), H(11));
      const r = await registry.recipients(doctor.address);
      expect(r.active).to.equal(true);
      expect(r.kemKeyHash).to.equal(H(10));
    });
  });

  describe("referral receipts", function () {
    beforeEach(async () => {
      await registry.connect(doctor).registerRecipient(H(1), H(2));
    });

    it("logs a referral receipt and emits ReferralLogged with hashes only", async () => {
      await expect(registry.connect(clinic).logReferral(H(21), H(22), doctor.address, H(23)))
        .to.emit(registry, "ReferralLogged")
        .withArgs(0, clinic.address, doctor.address, H(21), H(22), H(23));
      expect(await registry.receiptsCount()).to.equal(1);
      const receipt = await registry.receipts(0);
      expect(receipt.sender).to.equal(clinic.address);
      expect(receipt.recipient).to.equal(doctor.address);
      expect(receipt.envelopeHash).to.equal(H(21));
      expect(receipt.docHash).to.equal(H(22));
      expect(receipt.consentId).to.equal(H(23));
    });

    it("NEGATIVE: logging to an unregistered recipient is rejected", async () => {
      await expect(
        registry.connect(clinic).logReferral(H(21), H(22), otherDoctor.address, H(23)),
      ).to.be.revertedWithCustomError(registry, "NotRegistered");
    });

    it("NEGATIVE: logging to a revoked recipient is rejected", async () => {
      await registry.connect(doctor).revokeRecipient();
      await expect(
        registry.connect(clinic).logReferral(H(21), H(22), doctor.address, H(23)),
      ).to.be.revertedWithCustomError(registry, "RecipientRevokedError");
      expect(await registry.receiptsCount()).to.equal(0);
    });

    it("NEGATIVE: zero hashes are rejected in logReferral", async () => {
      await expect(
        registry.connect(clinic).logReferral(ethers.ZeroHash, H(22), doctor.address, H(23)),
      ).to.be.revertedWithCustomError(registry, "ZeroHash");
      await expect(
        registry.connect(clinic).logReferral(H(21), H(22), doctor.address, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(registry, "ZeroHash");
    });

    it("append-only: receipts accumulate and earlier receipts never change", async () => {
      await registry.connect(clinic).logReferral(H(21), H(22), doctor.address, H(23));
      await registry.connect(clinic).logReferral(H(31), H(32), doctor.address, H(33));
      expect(await registry.receiptsCount()).to.equal(2);
      const first = await registry.receipts(0);
      expect(first.envelopeHash).to.equal(H(21));
      const second = await registry.receipts(1);
      expect(second.envelopeHash).to.equal(H(31));
    });
  });
});
