// Sources flattened with hardhat v2.29.2 https://hardhat.org

// SPDX-License-Identifier: MIT

// File contracts/SealedMedRegistry.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.24;

/// @title SealedMedRegistry — hash-only registry for post-quantum encrypted medical referrals
/// @notice This contract NEVER stores medical data, plaintext, ciphertext payloads
///         for off-chain retrieval, or any key material other than *hashes* of a
///         recipient's public ML-KEM-1024 key and of their ML-DSA-signed recipient
///         card. It stores only:
///           - a commitment (hash) that a recipient facility published a KEM key,
///           - a commitment (hash) to the signed recipient card that binds that
///             KEM key + X25519 key to the facility's QoreChain account, and
///           - referral receipts: hashes of the sealed envelope and of the
///             plaintext document, sender, recipient, consent id and timestamp.
///         The sealed envelope itself travels off chain (clinic -> facility);
///         the chain is the audit log, not the mailbox.
contract SealedMedRegistry {
    struct Recipient {
        bytes32 kemKeyHash; // sha256 of the 1568-byte ML-KEM-1024 encapsulation key
        bytes32 cardHash; //   sha256 of the canonical recipient-card bytes
        bool active;
        uint64 registeredAt;
        uint64 updatedAt;
    }

    struct Receipt {
        address sender;
        address recipient;
        bytes32 envelopeHash;
        bytes32 docHash;
        bytes32 consentId;
        uint64 loggedAt;
    }

    /// @notice Recipient records, keyed by the facility's own EVM address.
    mapping(address => Recipient) public recipients;

    /// @notice Append-only referral receipts.
    Receipt[] public receipts;

    event RecipientRegistered(address indexed recipient, bytes32 kemKeyHash, bytes32 cardHash);
    event RecipientUpdated(address indexed recipient, bytes32 kemKeyHash, bytes32 cardHash);
    event RecipientRevoked(address indexed recipient);
    event ReferralLogged(
        uint256 indexed receiptId,
        address indexed sender,
        address indexed recipient,
        bytes32 envelopeHash,
        bytes32 docHash,
        bytes32 consentId
    );

    error ZeroHash();
    error NotRegistered(address recipient);
    error RecipientRevokedError(address recipient);
    error AlreadyRegisteredUseUpdate();

    /// @notice Registration of the caller's KEM key commitment and
    ///         recipient-card commitment. Only the caller's own entry can
    ///         ever be written (the mapping is keyed by `msg.sender`), so no
    ///         one can overwrite another facility's entry. Re-registering
    ///         while *active* is rejected: rotation of a live entry must go
    ///         through `updateRecipient`, which emits its own event. After a
    ///         revocation, registering again is allowed — that is the
    ///         recovery path for a compromised key.
    function registerRecipient(bytes32 kemKeyHash, bytes32 cardHash) external {
        if (kemKeyHash == bytes32(0) || cardHash == bytes32(0)) revert ZeroHash();
        Recipient storage r = recipients[msg.sender];
        if (r.active) revert AlreadyRegisteredUseUpdate();
        r.kemKeyHash = kemKeyHash;
        r.cardHash = cardHash;
        r.active = true;
        if (r.registeredAt == 0) r.registeredAt = uint64(block.timestamp);
        r.updatedAt = uint64(block.timestamp);
        emit RecipientRegistered(msg.sender, kemKeyHash, cardHash);
    }

    /// @notice Key rotation for an already-registered, active recipient.
    ///         Only the recipient itself can rotate its own entry; a revoked
    ///         recipient recovers through `registerRecipient` instead.
    function updateRecipient(bytes32 kemKeyHash, bytes32 cardHash) external {
        if (kemKeyHash == bytes32(0) || cardHash == bytes32(0)) revert ZeroHash();
        Recipient storage r = recipients[msg.sender];
        if (r.registeredAt == 0) revert NotRegistered(msg.sender);
        if (!r.active) revert RecipientRevokedError(msg.sender);
        r.kemKeyHash = kemKeyHash;
        r.cardHash = cardHash;
        r.updatedAt = uint64(block.timestamp);
        emit RecipientUpdated(msg.sender, kemKeyHash, cardHash);
    }

    /// @notice Revoke the caller's own recipient entry. After revocation, new
    ///         referrals to this recipient are rejected by `logReferral`.
    ///         Envelopes sealed before revocation are unaffected (they live
    ///         off chain); revocation stops *new* referrals, it does not and
    ///         cannot erase data already delivered.
    function revokeRecipient() external {
        Recipient storage r = recipients[msg.sender];
        if (r.registeredAt == 0) revert NotRegistered(msg.sender);
        r.active = false;
        r.updatedAt = uint64(block.timestamp);
        emit RecipientRevoked(msg.sender);
    }

    /// @notice Log a referral receipt. Only hashes and public metadata are
    ///         stored/emitted — never the envelope, the document, or any key.
    /// @param envelopeHash sha256 of the QoreSeal envelope bytes
    /// @param docHash      sha256 of the plaintext document (commitment only;
    ///                     the document itself never leaves the two facilities)
    /// @param recipient    facility address the envelope was sealed to
    /// @param consentId    id of the patient's ML-DSA-87 consent record
    /// @return receiptId   index of the stored receipt
    function logReferral(
        bytes32 envelopeHash,
        bytes32 docHash,
        address recipient,
        bytes32 consentId
    ) external returns (uint256 receiptId) {
        if (envelopeHash == bytes32(0) || docHash == bytes32(0) || consentId == bytes32(0)) {
            revert ZeroHash();
        }
        Recipient storage r = recipients[recipient];
        if (r.registeredAt == 0) revert NotRegistered(recipient);
        if (!r.active) revert RecipientRevokedError(recipient);

        receiptId = receipts.length;
        receipts.push(
            Receipt({
                sender: msg.sender,
                recipient: recipient,
                envelopeHash: envelopeHash,
                docHash: docHash,
                consentId: consentId,
                loggedAt: uint64(block.timestamp)
            })
        );
        emit ReferralLogged(receiptId, msg.sender, recipient, envelopeHash, docHash, consentId);
    }

    function receiptsCount() external view returns (uint256) {
        return receipts.length;
    }

    function isActiveRecipient(address recipient) external view returns (bool) {
        return recipients[recipient].active;
    }
}
