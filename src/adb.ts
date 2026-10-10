import { execFile } from "node:child_process";
import { isValidPackageName } from "./lists.js";

export type Exec = (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;

export type AdbErrorKind = "unauthorized" | "offline" | "not-found" | "failed";

export class AdbError extends Error {
  constructor(public kind: AdbErrorKind, message: string) {
    super(message);
    this.name = "AdbError";
  }
}

export interface Adb {
  connect(host: string): Promise<void>;
  installedPackages(): Promise<string[]>;
  removedPackages(): Promise<string[]>;
  removeForUser(pkg: string): Promise<void>;
  restore(pkg: string): Promise<void>;
  pullApk(pkg: string): Promise<Uint8Array>;
}

const HOST_RE = /^(\d{1,3}(\.\d{1,3}){3}|[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)$/;

const UNAUTHORIZED_MSG = "The TV hasn't approved this computer yet. Look at the TV screen and choose Allow.";
const UNREACHABLE_MSG = "Couldn't reach the Fire TV. Check the IP address and that ADB debugging is on.";

function parsePackages(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("package:"))
    .map((l) => l.slice("package:".length));
}

function classify(text: string): AdbErrorKind | null {
  const t = text.toLowerCase();
  if (t.includes("unauthorized") || t.includes("failed to authenticate")) return "unauthorized";
  if (t.includes("offline") || t.includes("cannot connect") || t.includes("no devices") || t.includes("not found") || t.includes("closed")) return "offline";
  return null;
}

function needPackage(pkg: string): void {
  if (!isValidPackageName(pkg)) throw new AdbError("failed", `Invalid package name: ${pkg}`);
}

export function createAdb(
  rawExec: Exec,
  opts: { pullToTemp?: (pkg: string, remotePath: string, serial: string | null) => Promise<Uint8Array> } = {},
): Adb {
  let serial: string | null = null;
  const exec: Exec = (args) => rawExec(serial && args[0] !== "connect" ? ["-s", serial, ...args] : args);
  const unreachable = () => new AdbError("offline", "Lost contact with the Fire TV. Check that it is on and on the same Wi-Fi.");

  async function listPackages(args: string[]): Promise<string[]> {
    const r = await exec(args);
    const bad = classify(`${r.stdout}
${r.stderr}`);
    if (bad) throw new AdbError(bad, bad === "unauthorized" ? UNAUTHORIZED_MSG : "Couldn't read the app list from the Fire TV.");
    const pkgs = parsePackages(r.stdout);
    if (r.code !== 0 || pkgs.length === 0) throw unreachable();
    return pkgs;
  }

  return {
    async connect(host) {
      if (!HOST_RE.test(host)) throw new AdbError("failed", "That doesn't look like a valid IP address.");
      const target = `${host}:5555`;
      const r = await exec(["connect", target]);
      const bad = classify(`${r.stdout}
${r.stderr}`);
      if (bad) throw new AdbError(bad, bad === "unauthorized" ? UNAUTHORIZED_MSG : UNREACHABLE_MSG);
      const state = await rawExec(["-s", target, "get-state"]);
      const stateBad = classify(`${state.stdout}
${state.stderr}`);
      if (stateBad) throw new AdbError(stateBad, stateBad === "unauthorized" ? UNAUTHORIZED_MSG : UNREACHABLE_MSG);
      serial = target;
    },

    installedPackages: () => listPackages(["shell", "pm", "list", "packages", "--user", "0"]),

    async removedPackages() {
      const [all, installed] = await Promise.all([
        listPackages(["shell", "pm", "list", "packages", "-u", "--user", "0"]),
        listPackages(["shell", "pm", "list", "packages", "--user", "0"]),
      ]);
      const have = new Set(installed);
      return all.filter((p) => !have.has(p));
    },

    async removeForUser(pkg) {
      needPackage(pkg);
      const r = await exec(["shell", "pm", "uninstall", "-k", "--user", "0", pkg]);
      if (/success/i.test(r.stdout)) return;
      const detail = r.stdout.trim() || r.stderr.trim();
      // Only pm's own refusal ("Failure [...]") means the TV is still talking to us.
      if (/failure/i.test(r.stdout)) throw new AdbError("failed", `Couldn't remove ${pkg}: ${detail}`);
      throw new AdbError(classify(`${r.stdout}
${r.stderr}`) ?? "offline", `Couldn't remove ${pkg}: ${detail || "no response from the TV"}`);
    },

    async restore(pkg) {
      needPackage(pkg);
      const r = await exec(["shell", "cmd", "package", "install-existing", "--user", "0", pkg]);
      if (/installed for user/i.test(r.stdout)) return;
      const detail = r.stdout.trim() || r.stderr.trim();
      const kind = classify(`${r.stdout}
${r.stderr}`) ?? (r.stdout.trim() && r.code === 0 ? "failed" : "offline");
      throw new AdbError(kind, `Couldn't restore ${pkg}: ${detail || "no response from the TV"}`);
    },

    async pullApk(pkg) {
      needPackage(pkg);
      const p = await exec(["shell", "pm", "path", pkg]);
      const line = p.stdout.split(/\r?\n/).find((l) => l.startsWith("package:"));
      if (!line) throw new AdbError("not-found", `${pkg} is not installed`);
      if (!opts.pullToTemp) throw new AdbError("failed", "APK pulling is not configured");
      return opts.pullToTemp(pkg, line.slice("package:".length).trim(), serial);
    },
  };
}

export function createRealExec(adbPath: string): Exec {
  return (args) =>
    new Promise((resolve) => {
      execFile(adbPath, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (!err) return resolve({ stdout: String(stdout), stderr: String(stderr), code: 0 });
        const e = err as Error & { code?: number | string; killed?: boolean };
        const code = typeof e.code === "number" ? e.code : -1;
        const extra = e.killed ? "adb timed out" : e.code === "ENOENT" ? "adb was not found" : "";
        resolve({ stdout: String(stdout), stderr: `${String(stderr)}${extra ? "\n" + extra : ""}`, code });
      });
    });
}
