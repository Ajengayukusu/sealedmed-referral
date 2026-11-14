# VIDEO SCRIPT — SealedMed Referral (Encrypted Apps)

- **Kategori:** Encrypted Apps · **Status:** LIVE di Diana (chainId 9800)
- **Kontrak:** `SealedMedRegistry` — `0x9aa1EF27d14F46e5Fbe399CE2402fDc0673b65C1`
- **Target durasi:** 2:30–2:55 (maksimum contest 3:00) · **Kecepatan baca acuan:** ~130 kata/menit
- **Jumlah kata narasi:** 360 kata · **Estimasi durasi baca:** ±2:46
- **Bahasa narasi:** Inggris (juri internasional). Semua data pasien di video adalah FIKSI (sesuai label di demo). Hash dibaca bentuk pendek saja.

## Tabel segmen

| Segmen | Waktu | Durasi | Isi | Kata |
|---|---|---|---|---|
| 1 | 0:00–0:16 | ±16 dtk | Hook — harvest now, decrypt later | 35 |
| 2 | 0:16–1:46 | ±90 dtk | Demo — 3 peran: dokter, klinik, pasien | 194 |
| 3 | 1:46–2:19 | ±33 dtk | Bukti on-chain — KEM + receipt | 72 |
| 4 | 2:19–2:38 | ±19 dtk | Keamanan — serangan kripto ditolak | 41 |
| 5 | 2:38–2:46 | ±8 dtk | Penutup — syarat kategori | 18 |

---

## Naskah narasi (voice-over)

### [0:00–0:16] Segmen 1 — Hook

> A medical referral written today must stay secret for decades. But anything encrypted with classical algorithms can be recorded now and decrypted after Q-Day. SealedMed keeps referrals sealed — with post-quantum encryption, in the browser.

### [0:16–1:46] Segmen 2 — Demo alur utama

> The demo has three roles. First, the receiving doctor: her facility generated QoreSeal keys and registered its ML-KEM-1024 key on-chain — algorithm two, fifteen hundred sixty-eight bytes — and published a recipient card signed with her ML-DSA-87 key, binding the encryption keys to her account. Second, the sending clinic: it verifies that card against the keys registered on-chain — no card, no trust — then encrypts the referral right here in the browser with QoreSeal: hybrid ML-KEM-1024 plus X25519, AES-256-GCM, bound to the Diana chain and to this exact purpose. Third, the patient: she consents with an ML-DSA-87 signature over the document and envelope hashes. The clinic logs only hashes — envelope hash, document hash, consent — as a receipt in the registry contract. The envelope itself travels off-chain. Finally, the doctor opens it in her browser with her own seal keys, and the document comes back byte for byte identical. Notice what never appears anywhere in this flow: no server ever sees the plaintext, no key ever leaves the browser that owns it, and the chain never stores the envelope — so there is nothing on-chain for a future quantum attacker to harvest.

### [1:46–2:19] Segmen 3 — Bukti on-chain

> On-chain, this all checks out. The doctor's ML-KEM key registration is a native transaction — fetch the key from the chain API and it reads back found, algorithm ML-KEM-1024, byte-identical. The registry contract holds her card commitment, and receipt number zero records the referral's hashes from the live run. The referral itself was fictional demo data — SealedMed is built for real clinics, but no real patient data ever touches this demo.

### [2:19–2:38] Segmen 4 — Keamanan

> The attacks are tested, not imagined: wrong key, wrong purpose, wrong chain, a tampered envelope, a forged recipient card, a forged or expired consent — all fifteen crypto tests reject them, and the registry refuses receipts for unregistered or revoked recipients.

### [2:38–2:46] Segmen 5 — Penutup

> SealedMed Referral: medical secrets that stay sealed after Q-Day — live on Diana for the Encrypted Apps track.

---

## Shot list per segmen

**Segmen 1 — Hook (0:00–0:16)**
- Layar: featured image, lalu panel "Dokter Tujuan" di frontend; overlay label **FIKSI** terlihat sejak awal (jangan pernah crop label ini).

**Segmen 2 — Demo (0:16–1:46)**
- Layar: frontend (`cd frontend && npm run dev`, http://localhost:5174) — 3 peran dalam satu app.
- Peran Dokter: tampilkan recipient card + status kunci (ML-KEM terdaftar, card terverifikasi).
- Peran Klinik: pilih dokumen rujukan FIKSI → klik verifikasi card (lolos) → klik **Seal** — tampilkan envelope (teks envelope QoreSeal) + envelope hash `0xd28eb7a4…391d93a6` dan doc hash `0x7bd53e1c…0d858813`.
- Peran Pasien: klik **Sign Consent (ML-DSA-87)** atas hash dokumen+envelope.
- Kembali ke Klinik: **Log Referral** — receipt tercatat (hash saja, tanpa plaintext).
- Peran Dokter: tempel envelope → klik **Open** — dokumen tampil kembali; bandingkan berdampingan dengan dokumen asli (identik byte-for-byte).

**Segmen 3 — Bukti on-chain (1:46–2:19)**
- Layar: browser REST `https://api-testnet.qore.host/qorechain/pqc/v1/kem/qor1359rgl28y45dldscnjzxqvcz6pz0qyrmjq488c` → `found:true`, `algorithm_id 2 (mlkem1024)`; tx register KEM `F528107596E50F0342C9ACD0527A75338BD331A8233023BB436214D925AB9772` (height 10087351).
- Explorer (Testnet): registry `0x9aa1EF27d14F46e5Fbe399CE2402fDc0673b65C1`; tx registerRecipient `0x965b2bf3…9d` dan logReferral `0x2dcbc2cd…23` (block 10087356) → receipt #0, receiptsCount 1.
- Tampilkan `deployments.testnet.json` bagian `referralDemo` (envelopeHash, docHash, consentIdHash `0x089b16e8…1fde49c`).

**Segmen 4 — Keamanan (2:19–2:38)**
- Layar: terminal `npm test` → crypto core 15/15 + kontrak 12/12; sorot nama test negatif (wrong key/purpose/chain, tampered, forged card, expired consent).
- Opsional potong 3 detik: demo open dengan kunci salah di UI → gagal (sesuai test).

**Segmen 5 — Penutup (2:38–2:46)**
- Layar: dokumen hasil Open + alamat registry; fade out. Label FIKSI tetap terlihat.

---

## Aset yang disiapkan sebelum rekam

1. Tab REST KEM dokter terbuka: `https://api-testnet.qore.host/qorechain/pqc/v1/kem/qor1359rgl28y45dldscnjzxqvcz6pz0qyrmjq488c` (pastikan respons `found:true` sudah termuat).
2. Tab explorer (Testnet): registry `0x9aa1EF27d14F46e5Fbe399CE2402fDc0673b65C1`, tx registerRecipient `0x965b2bf3…`, tx logReferral `0x2dcbc2cd…`.
3. Frontend berjalan lokal (port 5174) dengan dokumen rujukan FIKSI yang sama seperti run live (agar hash di layar cocok dengan receipt on-chain bila memakai mode live-read); siapkan juga run demo lokal cadangan.
4. Envelope hasil run live tersimpan sebagai file teks siap tempel untuk shot Open.
5. Terminal siap: `npm test` (root: core + kontrak) untuk shot Segmen 4.
6. Clipboard berurutan: alamat registry → hash registerRecipient → hash logReferral → URL REST KEM.
7. JANGAN gunakan data medis asli dalam rekaman apa pun — hanya dokumen berlabel FIKSI bawaan demo.
