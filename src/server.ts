import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { AdbError, type Adb } from "./adb.js";
import { loadCurated } from "./lists.js";
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
          const { packages } = await readBody(req);
          if (!Array.isArray(packages)) return send(res, 400, { error: "packages must be a list" });
          return send(res, 200, await removeApps(adb, log, packages.map(String)));
        }
        if (req.method === "GET" && url.pathname === "/api/removed") {
          const gone = new Set(await adb.removedPackages());
          return send(res, 200, { apps: curated.filter((a) => gone.has(a.pkg)) });
        }
        if (req.method === "POST" && url.pathname === "/api/restore") {
          const { packages } = await readBody(req);
          if (!Array.isArray(packages)) return send(res, 400, { error: "packages must be a list" });
          return send(res, 200, { restored: await restoreApps(adb, log, packages.map(String)) });
        }
        if (req.method === "GET" && url.pathname.startsWith("/api/icon/")) {
          const pkg = decodeURIComponent(url.pathname.slice("/api/icon/".length));
          if (!curated.some((a) => a.pkg === pkg)) return send(res, 404, { error: "unknown app" });
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
      if (e instanceof RejectedError) return send(res, 400, { error: e.message });
      if (e instanceof AdbError) return send(res, adbStatus(e.kind), { error: e.message, kind: e.kind });
      if (e instanceof SyntaxError) return send(res, 400, { error: "invalid JSON" });
      send(res, 500, { error: "Something went wrong." });
    }
  });
}
