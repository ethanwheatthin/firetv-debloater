import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdb, createRealExec, type Adb, type Exec } from "./adb.js";
import { discover, localIPv4, probePort5555 } from "./discover.js";
import { getIcon } from "./icons.js";
import { createLog } from "./log.js";
import { createServer } from "./server.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mock = process.argv.includes("--mock");
const dataHome = join(os.homedir(), ".firetv-debloater");

function findAdb(): string {
  const exe = process.platform === "win32" ? "adb.exe" : "adb";
  const bundled = join(root, "vendor", "platform-tools", exe);
  return existsSync(bundled) ? bundled : "adb"; // fall back to PATH
}

function mockAdb(): Adb {
  const gone = new Set<string>();
  const all = ["com.amazon.tv.csapp", "com.amazon.tv.legal.notices", "com.amazon.ags.app", "com.amazon.music.tv", "com.amazon.recess", "com.amazon.tv.launcher"];
  return {
    connect: async () => {},
    installedPackages: async () => all.filter((p) => !gone.has(p)),
    removedPackages: async () => [...gone],
    removeForUser: async (p) => { gone.add(p); },
    restore: async (p) => { gone.delete(p); },
    pullApk: async () => { throw new Error("mock: no APKs"); },
  };
}

function realAdb(): Adb {
  const adbPath = findAdb();
  const exec: Exec = createRealExec(adbPath);
  return createAdb(exec, {
    pullToTemp: async (_pkg, remotePath, serial) => {
      const dir = await mkdtemp(join(os.tmpdir(), "ftv-apk-"));
      const local = join(dir, "base.apk");
      try {
        await new Promise<void>((res, rej) =>
          execFile(adbPath, [...(serial ? ["-s", serial] : []), "pull", remotePath, local], { timeout: 60000, windowsHide: true }, (e) => (e ? rej(e) : res())));
        return new Uint8Array(await readFile(local));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  });
}

function freePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" && start < start + 50 ? resolve(freePort(start + 1)) : reject(e)));
    s.listen(start, "127.0.0.1", () => s.close(() => resolve(start)));
  });
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] :
    process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  execFile(cmd, args as string[], () => {});
}

const adb = mock ? mockAdb() : realAdb();
const server = createServer({
  adb,
  log: createLog(join(dataHome, "log.json")),
  publicDir: join(root, "public"),
  getIcon: (pkg) => getIcon((p) => adb.pullApk(p), pkg, join(dataHome, "icons")),
  discover: () => discover({ localIps: localIPv4(), probe: probePort5555 }),
});

const port = await freePort(3737);
server.listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}`;
  console.log(`Fire TV Debloater is running at ${url}${mock ? " (mock mode: no real TV)" : ""}`);
  openBrowser(url);
});
