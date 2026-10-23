# 1-Click Zoom development and publishing

Canonical listing: https://chromewebstore.google.com/detail/1-click-zoom/dgagkdkdaliokkoahnfaonddgdejfbod . It links KyleStay/1-Click_Zoom; the public CRX observed on 2026-10-23 is 4.1.1 and its RSA signature/public-key identity verifies to that ID.

Run `node --test tests/*.test.cjs`, `python3 tests/package.test.py`, then `python3 scripts/package.py`. Use only the production ZIP for the existing store item. Version 4.2.0 adds custom zoom presets and an explicit blue ON badge, with unchanged permissions and local/sync storage behavior. No store upload happened during preparation.

Optional separate dev packages pause passive navigation zoom and learning. Their unkeyed identity depends on their fixed absolute unpacked path and does not suppress production. For full behavior, prepare a same-ID replacement with the existing public key using scripts/prepare-replacement.py; no private signing key is needed. Runtime browser/restart/replacement verification remains unrun after the permitted runner was denied process ownership inspection.
