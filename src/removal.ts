import { AdbError, type Adb } from "./adb.js";
import { isProtected, isValidPackageName, loadCurated } from "./lists.js";
import type { Log, Mode } from "./log.js";

export type { Mode } from "./log.js";

export class RejectedError extends Error {
  constructor(public pkg: string, reason: string) {
    super(`${pkg}: ${reason}`);
    this.name = "RejectedError";
  }
}

export interface RemovalResult {
  removed: string[];
  skipped: { pkg: string; reason: string }[];
  errors: { pkg: string; reason: string }[];
  failed?: { pkg: string; reason: string };
  notAttempted: string[];
}

export interface RestoreResult {
  restored: string[];
  failed?: { pkg: string; reason: string };
  notAttempted: string[];
}

export interface RemoveOptions {
  /** Allow packages that are not on the curated list. Protected packages are still refused. */
  advanced?: boolean;
  mode?: Mode;
}

function validate(pkgs: string[], advanced: boolean): void {
  const curated = new Set(loadCurated().map((a) => a.pkg));
  for (const p of pkgs) {
    if (!isValidPackageName(p)) throw new RejectedError(p, "not a valid package name");
    if (isProtected(p)) throw new RejectedError(p, "protected; this app is needed by the Fire TV");
    if (!advanced && !curated.has(p)) throw new RejectedError(p, "not on the list of removable apps");
  }
}

export async function removeApps(adb: Adb, log: Log, requested: string[], opts: RemoveOptions = {}): Promise<RemovalResult> {
  const mode: Mode = opts.mode ?? "remove";
  const pkgs = [...new Set(requested)];
  validate(pkgs, opts.advanced === true);
  const installed = new Set(await adb.installedPackages());
  const result: RemovalResult = { removed: [], skipped: [], errors: [], notAttempted: [] };
  const todo: string[] = [];
  for (const pkg of pkgs) {
    if (installed.has(pkg)) todo.push(pkg);
    else result.skipped.push({ pkg, reason: "not installed on this TV" });
  }
  for (let i = 0; i < todo.length; i++) {
    const pkg = todo[i];
    try {
      if (mode === "disable") await adb.disableForUser(pkg);
      else await adb.removeForUser(pkg);
      log.record(pkg, mode);
      result.removed.push(pkg);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (e instanceof AdbError && e.kind === "failed") {
        // The TV answered and refused this one app; the rest can still be tried.
        result.errors.push({ pkg, reason });
        continue;
      }
      // Anything else (offline, unauthorized, unexpected) means we can't trust the TV: stop.
      result.failed = { pkg, reason };
      result.notAttempted = todo.slice(i + 1);
      return result;
    }
  }
  return result;
}

/** Packages this tool may bring back: the curated list plus anything it recorded removing or disabling. */
export function restorable(log: Log): Set<string> {
  return new Set([...loadCurated().map((a) => a.pkg), ...log.entries().map((e) => e.pkg)]);
}

export async function restoreApps(adb: Adb, log: Log, requested: string[]): Promise<RestoreResult> {
  const pkgs = [...new Set(requested)];
  const allowed = restorable(log);
  for (const p of pkgs) {
    if (!isValidPackageName(p)) throw new RejectedError(p, "not a valid package name");
    if (!allowed.has(p)) throw new RejectedError(p, "this tool didn't remove or disable it, so it won't restore it");
  }
  const removedOnTv = new Set(await adb.removedPackages());
  const disabledOnTv = new Set((await adb.packageStates()).disabled);
  const result: RestoreResult = { restored: [], notAttempted: [] };
  for (let i = 0; i < pkgs.length; i++) {
    const pkg = pkgs[i];
    const isRemoved = removedOnTv.has(pkg);
    const isDisabled = disabledOnTv.has(pkg);
    if (!isRemoved && !isDisabled) { log.clear(pkg); continue; }
    try {
      if (isDisabled) await adb.enable(pkg);
      else await adb.restore(pkg);
      log.clear(pkg);
      result.restored.push(pkg);
    } catch (e) {
      result.failed = { pkg, reason: e instanceof Error ? e.message : String(e) };
      result.notAttempted = pkgs.slice(i + 1);
      return result;
    }
  }
  return result;
}
