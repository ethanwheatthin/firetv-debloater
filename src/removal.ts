import { AdbError, type Adb } from "./adb.js";
import { isProtected, isValidPackageName, loadCurated } from "./lists.js";
import type { Log } from "./log.js";

export class RejectedError extends Error {
  constructor(public pkg: string, reason: string) {
    super(`${pkg}: ${reason}`);
    this.name = "RejectedError";
  }
}

export interface RemovalResult {
  removed: string[];
  skipped: { pkg: string; reason: string }[];
  failed?: { pkg: string; reason: string };
  notAttempted: string[];
}

function validate(pkgs: string[]): void {
  const curated = new Set(loadCurated().map((a) => a.pkg));
  for (const p of pkgs) {
    if (!isValidPackageName(p)) throw new RejectedError(p, "not a valid package name");
    if (isProtected(p)) throw new RejectedError(p, "protected; this app is needed by the Fire TV");
    if (!curated.has(p)) throw new RejectedError(p, "not on the list of removable apps");
  }
}

export async function removeApps(adb: Adb, log: Log, pkgs: string[]): Promise<RemovalResult> {
  validate(pkgs);
  const installed = new Set(await adb.installedPackages());
  const result: RemovalResult = { removed: [], skipped: [], notAttempted: [] };
  for (let i = 0; i < pkgs.length; i++) {
    const pkg = pkgs[i];
    if (!installed.has(pkg)) {
      result.skipped.push({ pkg, reason: "not installed on this TV" });
      continue;
    }
    try {
      await adb.removeForUser(pkg);
      log.record(pkg);
      result.removed.push(pkg);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      result.failed = { pkg, reason };
      result.notAttempted = pkgs.slice(i + 1).filter((p) => installed.has(p));
      if (!(e instanceof AdbError && e.kind === "offline")) {
        // A single app refusing removal does not mean the TV is gone; keep going.
        result.failed = undefined;
        result.skipped.push({ pkg, reason });
        result.notAttempted = [];
        continue;
      }
      return result;
    }
  }
  return result;
}

export async function restoreApps(adb: Adb, log: Log, pkgs: string[]): Promise<string[]> {
  for (const p of pkgs) if (!isValidPackageName(p)) throw new RejectedError(p, "not a valid package name");
  const removedOnTv = new Set(await adb.removedPackages());
  const restored: string[] = [];
  for (const pkg of pkgs) {
    if (!removedOnTv.has(pkg)) { log.clear(pkg); continue; }
    await adb.restore(pkg);
    log.clear(pkg);
    restored.push(pkg);
  }
  return restored;
}
