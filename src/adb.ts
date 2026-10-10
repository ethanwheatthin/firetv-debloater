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

export function createAdb(exec: Exec, opts: { pullToTemp?: (pkg: string, remotePath: string) => Promise<Uint8Array> } = {}): Adb {
  return {
    async connect(host) {
      if (!HOST_RE.test(host)) throw new AdbError("failed", "That doesn't look like a valid IP address.");
      const target = `${host}:5555`;
      const r = await exec(["connect", target]);
      const text = `${r.stdout}\n${r.stderr}`;
      const bad = classify(text);
      if (bad) throw new AdbError(bad, bad === "unauthorized"
        ? "The TV hasn't approved this computer yet. Look at the TV screen and choose Allow."
        : "Couldn't reach the Fire TV. Check the IP address and that ADB debugging is on.");
      const state = await exec(["-s", target, "get-state"]);
      const stateBad = classify(`${state.stdout}\n${state.stderr}`);
      if (stateBad) throw new AdbError(stateBad, stateBad === "unauthorized"
        ? "The TV hasn't approved this computer yet. Look at the TV screen and choose Allow."
        : "Couldn't reach the Fire TV. Check the IP address and that ADB debugging is on.");
    },

    async installedPackages() {
      const r = await exec(["shell", "pm", "list", "packages", "--user", "0"]);
      return parsePackages(r.stdout);
    },

    async removedPackages() {
      const [all, installed] = await Promise.all([
        exec(["shell", "pm", "list", "packages", "-u", "--user", "0"]),
        exec(["shell", "pm", "list", "packages", "--user", "0"]),
      ]);
      const have = new Set(parsePackages(installed.stdout));
      return parsePackages(all.stdout).filter((p) => !have.has(p));
    },

    async removeForUser(pkg) {
      needPackage(pkg);
      const r = await exec(["shell", "pm", "uninstall", "-k", "--user", "0", pkg]);
      const text = `${r.stdout}\n${r.stderr}`;
      if (/success/i.test(r.stdout)) return;
      throw new AdbError(classify(text) ?? "failed", `Couldn't remove ${pkg}: ${r.stdout.trim() || r.stderr.trim()}`);
    },

    async restore(pkg) {
      needPackage(pkg);
      const r = await exec(["shell", "cmd", "package", "install-existing", "--user", "0", pkg]);
      const text = `${r.stdout}\n${r.stderr}`;
      if (/installed for user/i.test(r.stdout)) return;
      throw new AdbError(classify(text) ?? "failed", `Couldn't restore ${pkg}: ${r.stdout.trim() || r.stderr.trim()}`);
    },

    async pullApk(pkg) {
      needPackage(pkg);
      const p = await exec(["shell", "pm", "path", pkg]);
      const line = p.stdout.split(/\r?\n/).find((l) => l.startsWith("package:"));
      if (!line) throw new AdbError("not-found", `${pkg} is not installed`);
      if (!opts.pullToTemp) throw new AdbError("failed", "APK pulling is not configured");
      return opts.pullToTemp(pkg, line.slice("package:".length).trim());
    },
  };
}

export function createRealExec(adbPath: string): Exec {
  return (args) =>
    new Promise((resolve) => {
      execFile(adbPath, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? ((err as unknown as { code: number }).code) : err ? 1 : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      });
    });
}
