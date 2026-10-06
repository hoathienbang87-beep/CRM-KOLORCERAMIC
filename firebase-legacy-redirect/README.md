# Firebase legacy QR redirect

This package is prepared for the legacy Firebase Hosting site only:

- Firebase project and Hosting site: `kolor-ceramics`
- Legacy origin: `https://kolor-ceramics.web.app`
- Canonical destination: `https://crmkolor.vercel.app/`
- Status: prepared and tested locally; **not deployed**
- Read-only baseline on 2026-09-30: live Hosting version `2259ef3eda629186`, status `FINALIZED`. Re-read the live version immediately before any authorized cutover; do not assume this baseline remains current.

The old site reads both `?id=...` and `?code=...`. Firebase Hosting preserves the incoming query string when these static redirects are applied, while the new catalog accepts both keys.

## Local verification

Run from the repository root:

```powershell
node scripts/test-firebase-legacy-qr-source-10.mjs
node scripts/test-firebase-redirect-10.mjs
Push-Location firebase-legacy-redirect
firebase emulators:exec --only hosting --project kolor-ceramics --config firebase.json "node ../scripts/test-firebase-redirect-10-http.mjs"
firebase deploy --only hosting --project kolor-ceramics --config firebase.json --dry-run
Pop-Location
```

## Production deployment gate

Do not deploy this package before Prompt 12B has passed every production confirmation and the Vercel catalog is healthy at the canonical destination.

Immediately before an authorized Firebase deploy:

1. Confirm CLI identity, project `kolor-ceramics`, site `kolor-ceramics`, and destination availability.
2. Record the current live Hosting version ID from Firebase Hosting release history.
3. Clone the current live version to a dated safety channel:

   ```powershell
   firebase hosting:clone kolor-ceramics:live kolor-ceramics:pre-catalog-cutover-YYYYMMDD --project kolor-ceramics
   ```

4. Re-run the static and emulator tests.
5. Only then deploy Hosting from this directory with the explicit project flag.

No command in this document is authorized by Prompt 10; Prompt 10 only prepares and tests the package locally.

## Rollback

Preferred rollback: in Firebase Console → Hosting → Release history, select the recorded pre-cutover release and choose **Roll back**.

If the dated safety channel was created and verified, an authorized operator can restore that exact version with:

```powershell
firebase hosting:clone kolor-ceramics:pre-catalog-cutover-YYYYMMDD kolor-ceramics:live --project kolor-ceramics
```

After rollback, verify that the legacy catalog loads and that the Firebase release history shows the restored version. Never use `hosting:disable` as rollback.
