import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer } from "../src/server.js";
import { createLog } from "../src/log.js";
import { AdbError, type Adb } from "../src/adb.js";

const calls: string[] = [];
let connectError: AdbError | null = null;
const adb: Adb = {
  connect: async () => { if (connectError) throw connectError; },
  installedPackages: async () => ["com.amazon.tv.csapp", "com.amazon.music.tv"],
  removedPackages: async () => ["com.amazon.ags.app"],
  removeForUser: async (p) => { calls.push(`remove ${p}`); },
  restore: async (p) => { calls.push(`restore ${p}`); },
  pullApk: async () => new Uint8Array(),
};

let server: Server;
let base: string;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "ftv-srv-"));
  server = createServer({ adb, log: createLog(join(dir, "log.json")), publicDir: join(process.cwd(), "public"), getIcon: async () => null });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("API", () => {
  it("rejects a protected package with 400 and never touches the TV", async () => {
    calls.length = 0;
    const res = await post("/api/remove", { packages: ["com.amazon.tv.launcher"] });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });
  it("returns 409 unauthorized with guidance to approve on the TV", async () => {
    connectError = new AdbError("unauthorized", "The TV hasn't approved this computer yet. Look at the TV screen and choose Allow.");
    const res = await post("/api/connect", { host: "192.168.1.5" });
    connectError = null;
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.kind).toBe("unauthorized");
    expect(body.error).toMatch(/TV/);
  });
  it("connects successfully", async () => {
    const res = await post("/api/connect", { host: "192.168.1.5" });
    expect(res.status).toBe(200);
  });
  it("lists apps, preselecting only installed safe ones", async () => {
    const body = await (await fetch(base + "/api/apps")).json();
    const byPkg = Object.fromEntries(body.apps.map((a: any) => [a.pkg, a]));
    expect(byPkg["com.amazon.tv.csapp"]).toMatchObject({ installed: true, selected: true });
    expect(byPkg["com.amazon.music.tv"]).toMatchObject({ installed: true, selected: false });
    expect(byPkg["com.amazon.ags.app"]).toMatchObject({ installed: false, selected: false });
    expect(body.protectedCount).toBeGreaterThan(0);
  });
  it("removes a curated package", async () => {
    calls.length = 0;
    const res = await post("/api/remove", { packages: ["com.amazon.tv.csapp"] });
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toEqual(["com.amazon.tv.csapp"]);
  });
  it("lists curated apps currently removed on the TV", async () => {
    const body = await (await fetch(base + "/api/removed")).json();
    expect(body.apps.map((a: any) => a.pkg)).toEqual(["com.amazon.ags.app"]);
  });
  it("restores", async () => {
    const res = await post("/api/restore", { packages: ["com.amazon.ags.app"] });
    expect((await res.json()).restored).toEqual(["com.amazon.ags.app"]);
  });
  it("returns 404 for icons it cannot find", async () => {
    expect((await fetch(base + "/api/icon/com.amazon.tv.csapp")).status).toBe(404);
  });
  it("blocks path traversal on static files", async () => {
    const res = await fetch(base + "/..%2fpackage.json");
    expect(res.status).toBe(404);
  });
  it("serves the index page", async () => {
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ok");
  });
});

describe("review fixes: cross-site protection", () => {
  it("rejects requests with a foreign Host header (DNS rebinding)", async () => {
    const res = await new Promise<number>((resolve) => {
      const u = new URL(base);
      import("node:http").then(({ default: http }) => {
        http.get({ host: u.hostname, port: u.port, path: "/api/apps", headers: { Host: "evil.example" } }, (r) => { r.resume(); resolve(r.statusCode ?? 0); });
      });
    });
    expect(res).toBe(403);
  });
  it("rejects POSTs from a foreign Origin", async () => {
    calls.length = 0;
    const res = await fetch(base + "/api/remove", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ packages: ["com.amazon.tv.csapp"] }),
    });
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("rejects POSTs that are not application/json", async () => {
    calls.length = 0;
    const res = await fetch(base + "/api/remove", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ packages: ["com.amazon.tv.csapp"] }) });
    expect(res.status).toBe(415);
    expect(calls).toEqual([]);
  });
  it("returns a 400 or 404 (not 500) for a malformed URL escape", async () => {
    const res = await fetch(base + "/%E0%A4%A");
    expect([400, 404]).toContain(res.status);
  });
});
