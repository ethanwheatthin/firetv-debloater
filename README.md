# Fire TV Debloater

A free, open-source tool that removes bloatware from your Fire TV through a simple four-step web wizard: **Connect, Choose apps, Review, Done**. It runs on your own computer and talks to your TV over your home network. Nothing is sent anywhere else.

## Safety

- Apps are removed with `pm uninstall -k --user 0`. That hides and stops the app for your user but leaves it on the TV, so **every removal can be undone** (per app, or "Undo everything").
- A protected list of system apps (launcher, setup, settings, and so on) is enforced by the server and can never be removed, even if someone tampers with the page.
- Only apps on a curated list can be removed. Advanced mode is not in version 1.

> **Important: the curated list is unverified.** Every entry in `data/curated.json` is marked `"verified": false`. The package names were drafted without access to a real Fire TV. Test on your own device and fix or remove entries before you recommend this to anyone. Please report what you find.

## Set up your Fire TV

1. Settings → My Fire TV → About → click your device name 7 times to unlock Developer Options.
2. Settings → My Fire TV → Developer Options → turn **ADB debugging** on.
3. Find the TV's IP address under About → Network.
4. When you click Connect in the app, choose **Allow** on the TV screen.

## Run it

```bash
npm install
npx tsx scripts/fetch-platform-tools.ts   # downloads Google's adb into vendor/
npm run dev                               # opens http://localhost:3737
npm run dev -- --mock                     # try the UI with a fake TV, no hardware needed
npm test
```

## Status and known gaps

- Single-file downloads per operating system are **not built yet**. For now you run it from source as above.
- `scripts/fetch-platform-tools.ts` downloads Google's "latest" platform-tools; pinning an exact version is still to do.
- Icons are pulled from each app's APK on the TV (best effort). Apps that only use vector icons show a generic placeholder.
- Release builds are unsigned, so Windows SmartScreen and macOS Gatekeeper will warn. Windows: More info → Run anyway. macOS: right-click the app → Open.
- `pm uninstall -k --user 0` and `cmd package install-existing` are assumed to work on your Fire OS version. Verify on real hardware.

## Licence

MIT.
