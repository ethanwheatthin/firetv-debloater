import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { AdbError, type Adb } from "./adb.js";
import { isProtected, isValidPackageName, loadCurated } from "./lists.js";
import type { Log } from "./log.js";
import { removeApps, restoreApps, RejectedError } from "./removal.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

export interface ServerDeps {
  adb: Adb;
  log: Log;
  publicDir: string;
  getIcon: (pkg: string) => Promise<Buffer | null>;
  discover?: () => Promise<string[]>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new RejectedError("request", "body too large");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function protectedCount(): number {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
  return (JSON.parse(readFileSync(join(dir, "protected.json"), "utf8")) as string[]).length;
}

function adbStatus(kind: AdbError["kind"]): number {
  return kind === "unauthorized" ? 409 : kind === "offline" ? 503 : kind === "not-found" ? 404 : 500;
}

export function createServer(deps: ServerDeps): http.Server {
  const { adb, log, publicDir } = deps;
  const root = resolve(publicDir);
  const curated = loadCurated();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      // Only this computer's own page may talk to us (blocks DNS rebinding and cross-site requests).
      const port = req.socket.localPort;
      const host = (req.headers.host ?? "").toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: "forbidden" });
      if (req.method === "POST") {
        const origin = req.headers.origin;
        if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(res, 403, { error: "forbidden" });
        if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return send(res, 415, { error: "expected JSON" });
      }
      if (url.pathname.startsWith("/api/")) {
        if (req.method === "POST" && url.pathname === "/api/connect") {
          const { host } = await readBody(req);
          await adb.connect(String(host ?? ""));
          return send(res, 200, { ok: true });
        }
        if (req.method === "GET" && url.pathname === "/api/discover") {
          return send(res, 200, { hosts: deps.discover ? await deps.discover() : [] });
        }
        if (req.method === "GET" && url.pathname === "/api/apps") {
          const installed = new Set(await adb.installedPackages());
          const apps = curated.map((a) => ({
            ...a,
            installed: installed.has(a.pkg),
            selected: installed.has(a.pkg) && a.tag === "safe",
          }));
          return send(res, 200, { apps, protectedCount: protectedCount() });
        }
        if (req.method === "POST" && url.pathname === "/api/remove") {
          const { packages, advanced, mode } = await readBody(req);
          if (!Array.isArray(packages)) return send(res, 400, { error: "packages must be a list" });
          if (mode !== undefined && mode !== "remove" && mode !== "disable") return send(res, 400, { error: "mode must be remove or disable" });
          return send(res, 200, await removeApps(adb, log, packages.map(String), { advanced: advanced === true, mode }));
        }
        if (req.method === "GET" && url.pathname === "/api/all-apps") {
          const { installed, system, disabled } = await adb.packageStates();
          const sys = new Set(system);
          const off = new Set(disabled);
          const byPkg = new Map(curated.map((a) => [a.pkg, a]));
          const apps = installed.map((pkg) => {
            const c = byPkg.get(pkg);
            return {
              pkg,
              name: c?.name ?? pkg,
              curated: !!c,
              tag: c?.tag ?? null,
              explanation: c?.explanation ?? null,
              system: sys.has(pkg),
              disabled: off.has(pkg),
              locked: isProtected(pkg),
            };
          });
          apps.sort((x, y) => Number(y.curated) - Number(x.curated) || x.pkg.localeCompare(y.pkg));
          return send(res, 200, { apps });
        }
        if (req.method === "GET" && url.pathname === "/api/removed") {
          const gone = new Set(await adb.removedPackages());
          const off = new Set((await adb.packageStates()).disabled);
          const byPkg = new Map(curated.map((a) => [a.pkg, a]));
          const logged = new Map(log.entries().map((e) => [e.pkg, e]));
          const candidates = new Set([...byPkg.keys(), ...logged.keys()]);
          const apps = [...candidates]
            .filter((pkg) => gone.has(pkg) || off.has(pkg))
            .map((pkg) => {
              const c = byPkg.get(pkg);
              return { pkg, name: c?.name ?? pkg, tag: c?.tag ?? null, explanation: c?.explanation ?? null, mode: off.has(pkg) ? "disable" : "remove" };
            });
          return send(res, 200, { apps });
        }
        if (req.method === "POST" && url.pathname === "/api/restore") {
          const { packages } = await readBody(req);
          if (!Array.isArray(packages)) return send(res, 400, { error: "packages must be a list" });
          return send(res, 200, await restoreApps(adb, log, packages.map(String)));
        }
        if (req.method === "GET" && url.pathname.startsWith("/api/icon/")) {
          const pkg = decodeURIComponent(url.pathname.slice("/api/icon/".length));
          if (!isValidPackageName(pkg)) return send(res, 404, { error: "unknown app" });
          const icon = await deps.getIcon(pkg);
          if (!icon) return send(res, 404, { error: "no icon" });
          res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=3600" });
          return res.end(icon);
        }
        return send(res, 404, { error: "not found" });
      }

      if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });
      const rel = normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
      const file = resolve(join(root, rel));
      if (file !== root && !file.startsWith(root + sep)) return send(res, 404, { error: "not found" });
      try {
        const data = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(data);
      } catch {
        send(res, 404, { error: "not found" });
      }
    } catch (e) {
      if (e instanceof URIError) return send(res, 400, { error: "bad request" });
      if (e instanceof RejectedError) return send(res, 400, { error: e.message });
      if (e instanceof AdbError) return send(res, adbStatus(e.kind), { error: e.message, kind: e.kind });
      if (e instanceof SyntaxError) return send(res, 400, { error: "invalid JSON" });
      send(res, 500, { error: "Something went wrong." });
    }
  });
}
