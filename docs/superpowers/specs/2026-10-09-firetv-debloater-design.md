# Fire TV Debloater: Design

## Intent and why

Fire TVs ship with apps people never use. Some can't be removed from the TV's own menu, and some slow the TV down. Removing them normally needs ADB (Android Debug Bridge) commands, which non-technical people can't or won't do.

This project is a free, open-source tool that lets anyone connect to their Fire TV and clear out bloatware through a simple web interface, without knowing what ADB is. The author will publish a YouTube tutorial video for a public audience ("everyone"), so setup must be short and the tool must feel safe.

## Goals

- A non-technical person can go from download to bloatware removed in a few minutes by following the video.
- Works on Windows, macOS and Linux.
- Removes apps the Fire TV menu won't uninstall, and apps that slow the TV down.
- Shows an app icon, name and plain-English explanation for each removable app.
- Every removal is reversible.
- Free and open source.

## Non-goals

- Not a general Android/ADB toolbox (no sideloading, file transfer, screen mirroring, etc.).
- Not hosted: no cloud service, no accounts, no data collected.
- Not for phones or non-Fire-TV Android devices.

## Anti-goals

- **Bricking the TV is the failure that matters most.** If the tool can leave a TV unable to boot, sign in, or show the home screen, it has failed even if everything else works.
- Being so cautious it removes almost nothing is a lesser failure, but the safety bar wins any conflict.

## Constraints

- A browser cannot talk to a Fire TV over the network by itself, so a small helper program on the user's own computer runs ADB. The web interface is served by that helper.
- Delivered as one download per operating system (Windows, macOS, Linux). Double-clicking it opens the app in the user's browser. Users install nothing else; Google's official ADB tool is bundled.
- Stack (builder's default, chosen with the author's agreement): TypeScript on Node.js.
- Fire TV connects over the home network (ADB over TCP, port 5555), which requires the user to enable Developer Options and ADB debugging on the TV and approve the computer on the TV screen.

## Decisions made with the author

- **Curated list first, advanced mode later.** By default the app only shows a curated list of known removable apps. An advanced mode (a switch on the Choose Apps step) reveals every installed app.
- **Wizard layout** (chosen over a single checklist page). Four steps:
  1. **Connect.** Finds the Fire TV on the network and connects.
  2. **Choose apps.** The curated list, safest picks pre-selected, protected apps shown locked.
  3. **Review.** A plain-language summary of what will be removed and what each removal affects, then a Remove button.
  4. **Done.** Shows what was removed and offers Undo.
- **App icons** are shown for every app that will be removed.

## Safety model (builder's calls, proposed to the author, who has not objected)

- **Reversible removal only.** Use `pm uninstall -k --user 0 <package>`, which removes the app for the user but leaves it on the TV's system partition. Never delete anything permanently.
- **Protected list.** Apps the Fire TV needs to boot, sign in, or run the home screen are locked and can't be selected, even in advanced mode.
- **Tags on each app:** "Safe to remove", "Removing this loses a feature", "Not recommended", each with a plain-English explanation.
- **Undo.** Every removal is logged on the user's computer. The user can restore any single app, or all of them, with one click (for example via `cmd package install-existing`).

## Builder's calls (marked as such; the author did not decide these)

- **Icons come from the TV itself.** The app reads each app's icon from the TV. Apps whose icon can't be read get a generic placeholder.
- **The app walks people through the TV setup** (Developer Options, ADB debugging, approving the computer) with step-by-step pictures on the Connect step. The author said "looks good" to the flow but did not answer whether to include this; it is included by default.
- **Steps 3 and 4 content** (Review summary, Undo on the Done screen) are the builder's proposal, accepted as "looks good".

## More builder's calls (from the builder check; the author did not decide these)

- **Verify the removal command early.** `pm uninstall -k --user 0` is assumed to work without root on Fire OS, but this must be confirmed on real hardware before anything else is built on it. If it fails on a Fire OS version, fall back to `pm disable-user`, or mark that version unsupported.
- **Undo does not depend only on the local log.** The log is stored in the user's data directory (not next to the download). Restore can also be derived from the TV itself (`pm list packages -u`), so Undo still works if the log is lost or the tool is run from another computer.
- **Partial failures.** Apps are removed one at a time and each result is checked. If the TV disconnects mid-batch, the tool stops, reports exactly what was and wasn't removed, and logs it accurately. No automatic rollback.
- **ADB distribution.** Google's platform-tools are fetched at build time at a pinned version (redistribution is allowed under the Android SDK terms) and bundled into each download.
- **Setup pictures** are generic illustrations of the Developer Options and ADB debugging steps, with text that tells people what to look for if their menus differ.

## Calls made when the author said "make all the decisions and start building"

- **Hardware:** assume no device is available to the builder. The curated list ships conservative (allowlist only), tests run against a mock ADB, and real-device verification is flagged as the author's step before release.
- **Seed list:** the builder drafts it from community knowledge, marks every entry unverified, and keeps it in an easy-to-edit data file.
- **Version 1 is curated-only.** Advanced mode is deferred to a follow-up; the protected list still applies when it ships.
- **No code-signing certificate assumed.** The README and video notes cover the Windows/Mac security warnings.

## Left to the builder

- Project structure, packaging and signing approach for each operating system.
- How the Fire TV is discovered on the network, and the manual fallback (typing the IP address).
- Contents of the curated and protected lists, and how they are maintained and updated as Amazon changes its software.
- Visual design details beyond the wizard layout and the icons/tags described above.
- Choice of open-source licence.
- Handling of different Fire OS versions and device types (Stick, Cube, Fire TV Edition TVs).
