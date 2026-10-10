# Fire TV Debloater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app (single download per OS) that connects to a Fire TV over ADB and safely, reversibly removes bloatware through a four-step wizard.

**Architecture:** A Node.js/TypeScript helper runs a small HTTP server on localhost. The server shells out to a bundled `adb` through an injectable `Exec` function (so everything is testable against a mock). A framework-free static frontend in `public/` drives the wizard through a JSON API.

**Tech Stack:** Node 24, TypeScript, `tsx` (dev), `vitest` (tests), `fflate` (read APK zips for icons), built-in `node:http`. No web framework, no frontend build step.

**Spec:** `docs/superpowers/specs/2026-10-09-firetv-debloater-design.md`

## Global Constraints

- Removal is **only** `pm uninstall -k --user 0 <package>`; never a permanent delete.
- Restore is `cmd package install-existing <package>`; restoring a package is derived from the TV (`pm list packages -u` minus `pm list packages`), not only the local log.
- Protected packages can never be removed, enforced **server-side**, regardless of what the UI sends.
- Curated list only in v1; advanced mode is NOT built.
- Every curated entry has `verified: false` until the author confirms it on real hardware.
- Wizard steps, in order: Connect, Choose apps, Review, Done.
- Tags: `safe` ("Safe to remove"), `loses-feature` ("Removing this loses a feature"), `not-recommended` ("Not recommended"). Safest picks (`safe`) are pre-selected.
- ADB port 5555. Undo log lives in `os.homedir()/.firetv-debloater/log.json`.
- Free and open source (MIT licence). No telemetry, no network calls except to the local TV.

## Review Focus

- A selected package that is on the protected list, sent directly to the API: must be rejected with HTTP 400 and nothing run on the TV.
- A package name containing shell metacharacters (`com.x; rm -rf /`): rejected before any `adb` call.
- TV drops mid-batch: removal stops, response reports exactly which packages were removed and which were not, and the log matches.
- TV shows "unauthorized" (user hasn't approved the computer on the TV): connect returns a clear, specific message, not a generic failure.
- A curated package that isn't installed on this TV: skipped with a note, not an error.

---

### Task 1: Scaffold, types and app lists

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE` (MIT), `src/types.ts`, `data/curated.json`, `data/protected.json`, `src/lists.ts`
- Test: `tests/lists.test.ts`

**Interfaces:**
- Produces:
  - `type Tag = "safe" | "loses-feature" | "not-recommended"`
  - `interface CuratedApp { pkg: string; name: string; tag: Tag; explanation: string; verified: boolean }`
  - `loadCurated(): CuratedApp[]`, `isProtected(pkg: string): boolean`, `isValidPackageName(s: string): boolean`

- [ ] **Step 1:** `git init`; create the scaffold files with scripts `dev`, `build`, `test`, `start`; install `typescript tsx vitest fflate @types/node`.
- [ ] **Step 2:** Write failing tests in `tests/lists.test.ts`: `isValidPackageName("com.amazon.foo")` is true, `isValidPackageName("com.x; rm -rf /")` and `""` are false; `isProtected("com.amazon.tv.launcher")` is true; no curated package is protected; every curated entry has `verified === false` and a non-empty `explanation`; no duplicate packages.
- [ ] **Step 3:** Run `npx vitest run` — expect FAIL.
- [ ] **Step 4:** Implement `src/lists.ts` and populate `data/protected.json` (launcher, system UI, setup wizard, package installer, settings, `android`, `com.amazon.device.*` prefix entries) and `data/curated.json` with a conservative starter set of well-known promo/bloat packages. `protected.json` supports exact names and prefixes ending in `*`.
- [ ] **Step 5:** Run tests — expect PASS. Commit.

### Task 2: ADB wrapper

**Files:**
- Create: `src/adb.ts`
- Test: `tests/adb.test.ts`

**Interfaces:**
- Produces:
  - `type Exec = (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>`
  - `class AdbError extends Error { kind: "unauthorized" | "offline" | "not-found" | "failed" }`
  - `createAdb(exec: Exec): Adb` where `Adb` has `connect(host: string): Promise<void>`, `installedPackages(): Promise<string[]>`, `removedPackages(): Promise<string[]>`, `removeForUser(pkg: string): Promise<void>`, `restore(pkg: string): Promise<void>`
  - `createRealExec(adbPath: string): Exec` (spawns the binary, no shell)

- [ ] **Step 1:** Failing tests with a fake `Exec`: `connect("192.168.1.5")` runs `["connect","192.168.1.5:5555"]`; output containing `unauthorized` throws `AdbError` kind `unauthorized`; `cannot connect` throws kind `offline`; `installedPackages` parses `package:x` lines; `removedPackages` is `pm list packages -u` minus installed; `removeForUser` runs `["shell","pm","uninstall","-k","--user","0",pkg]` and throws kind `failed` unless stdout contains `Success`; every method rejects an invalid package name before calling `exec`.
- [ ] **Step 2:** Run — expect FAIL. Implement. Run — expect PASS. Commit.

### Task 3: Removal engine and undo log

**Files:**
- Create: `src/removal.ts`, `src/log.ts`
- Test: `tests/removal.test.ts`

**Interfaces:**
- Consumes: `Adb`, `isProtected`, `isValidPackageName`, `loadCurated`
- Produces:
  - `interface RemovalResult { removed: string[]; skipped: { pkg: string; reason: string }[]; failed?: { pkg: string; reason: string }; notAttempted: string[] }`
  - `removeApps(adb: Adb, log: Log, pkgs: string[]): Promise<RemovalResult>`; throws `RejectedError` (carries the offending package) for protected, invalid, or non-curated packages before touching the TV
  - `restoreApps(adb: Adb, log: Log, pkgs: string[]): Promise<string[]>`
  - `createLog(filePath: string): Log` with `record(pkg: string): void`, `entries(): { pkg: string; at: string }[]`, `clear(pkg: string): void`

- [ ] **Step 1:** Failing tests with a mock `Adb`: protected package → `RejectedError`, mock never called; non-installed curated package lands in `skipped`; mid-batch `AdbError` kind `offline` stops the batch, remaining packages are in `notAttempted`, earlier ones in `removed` and in the log; `restoreApps` for a package present in `removedPackages()` but missing from the log still restores it.
- [ ] **Step 2:** Run — expect FAIL. Implement (remove one at a time, verify each, record to log after each success). Run — expect PASS. Commit.

### Task 4: HTTP server and API

**Files:**
- Create: `src/server.ts`, `src/index.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces `createServer(deps: { adb: Adb; log: Log; publicDir: string }): http.Server` with JSON routes:
  - `POST /api/connect {host}` → 200 `{ ok: true }` or 4xx `{ error, kind }`
  - `GET /api/apps` → `{ apps: (CuratedApp & { installed: boolean; selected: boolean })[], protectedCount: number }` (`selected` true for `safe` + installed)
  - `POST /api/remove {packages}` → `RemovalResult`; 400 for `RejectedError`
  - `GET /api/removed` → apps currently removed on the TV that are curated
  - `POST /api/restore {packages}` → `{ restored: string[] }`
  - `GET /api/icon/:pkg` → PNG or 404
  - Static files from `publicDir`, with path traversal blocked.
- `src/index.ts`: finds a free port (default 3737, increments if taken), starts the server bound to `127.0.0.1`, opens the browser.

- [ ] **Step 1:** Failing tests via real HTTP against `createServer` with a mock `Adb`: protected package to `/api/remove` → 400 and the mock's `removeForUser` never called (Review Focus 1); `connect` unauthorized → status 409 with `kind: "unauthorized"` and a message mentioning approving on the TV (Review Focus 4); `GET /../package.json` → 404; `/api/apps` marks `selected` only for installed `safe` apps.
- [ ] **Step 2:** Run — expect FAIL. Implement. Run — expect PASS. Commit.

### Task 5: Icons

**Files:**
- Create: `src/icons.ts`
- Test: `tests/icons.test.ts`

**Interfaces:**
- Produces `getIcon(pull: (pkg: string) => Promise<Uint8Array>, pkg: string, cacheDir: string): Promise<Buffer | null>`; extend `Adb` with `pullApk(pkg: string): Promise<Uint8Array>` (via `shell pm path` then `pull`). Best effort: choose the largest PNG under `res/` whose path contains `ic_launcher` or `icon`; return `null` when only vector/adaptive XML icons exist. Caches by package.

- [ ] **Step 1:** Failing tests that build an in-memory zip with `fflate`: returns the largest matching PNG; returns `null` for a zip with only XML; second call hits the cache (pull called once).
- [ ] **Step 2:** Run — FAIL. Implement; wire `/api/icon/:pkg` to it. Run — PASS. Commit.

### Task 6: Wizard frontend

**Files:**
- Create: `public/index.html`, `public/app.js`, `public/style.css`, `public/placeholder.svg`

**Interfaces:**
- Consumes the Task 4 API.

- [ ] **Step 1:** Build the four-step wizard as one page with a step indicator matching the mockup: **Connect** (IP field, Connect button, collapsible "How do I set up my Fire TV?" with the Developer Options → ADB debugging → approve-on-TV steps and generic illustrated placeholders), **Choose apps** (icon cards with name, tag label and explanation; `safe` pre-selected; protected-count note), **Review** (plain-language summary of selected apps and their tags, Remove button), **Done** (removed / skipped / not attempted lists, Undo-all button, per-app restore from `/api/removed`). Icon `<img>` falls back to `placeholder.svg` on error.
- [ ] **Step 2:** Run the app against a mock `Adb` dev mode (`npm run dev -- --mock`) and click through all four steps in the browser; confirm each renders and the Remove call reaches the mock. Commit.

### Task 7: Subnet discovery, packaging and docs

**Files:**
- Create: `src/discover.ts`, `scripts/fetch-platform-tools.ts`, `README.md`
- Test: `tests/discover.test.ts`

**Interfaces:**
- Produces `discover(opts: { probe: (ip: string) => Promise<boolean>; localIps: string[] }): Promise<string[]>` — probes the local /24 for port 5555; `/api/discover` route returns candidates; the Connect step offers "Find my Fire TV" next to manual entry.

- [ ] **Step 1:** Failing test: with a fake probe true only for `192.168.1.42` and local IP `192.168.1.10`, `discover` returns `["192.168.1.42"]` and never probes outside the /24.
- [ ] **Step 2:** Run — FAIL. Implement; run — PASS.
- [ ] **Step 3:** `scripts/fetch-platform-tools.ts` downloads Google's pinned platform-tools zip per OS into `vendor/`; add a `package` script producing one executable per OS bundling `public/`, `data/` and `vendor/` (Node single-executable or `@yao-pkg/pkg`; the builder picks).
- [ ] **Step 4:** `README.md`: what it does, setup on the TV, how to run, the unsigned-binary Windows/Mac warning workarounds, and a prominent note that every curated app is unverified until tested on real hardware. Commit.

---

## Self-review notes

- Spec coverage: wizard (T6), curated-only (T1/T4), protected list + server enforcement (T1/T3/T4), reversible removal + Undo derived from TV (T2/T3), icons (T5), cross-OS packaging and warnings (T7), open source (T1). Setup walkthrough and generic pictures (T6).
- Review Focus mapping: protected-via-API → T4; metacharacters → T1/T2; mid-batch drop → T3; unauthorized → T2/T4; not-installed → T3.
- Known unverified: `pm uninstall -k --user 0` behaviour on real Fire OS; the author must verify before release (README states this).
