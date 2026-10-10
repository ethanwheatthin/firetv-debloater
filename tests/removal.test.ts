import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeApps, restoreApps, RejectedError } from "../src/removal.js";
import { createLog } from "../src/log.js";
import { AdbError, type Adb } from "../src/adb.js";

function mockAdb(over: Partial<Adb> = {}): Adb & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    connect: async () => {},
    installedPackages: async () => ["com.amazon.tv.csapp", "com.amazon.ags.app", "com.amazon.recess"],
    removedPackages: async () => [],
    removeForUser: async (p) => { removed.push(p); },
    restore: async () => {},
    pullApk: async () => new Uint8Array(),
    ...over,
  };
}
const newLog = () => createLog(join(mkdtempSync(join(tmpdir(), "ftv-")), "log.json"));

describe("removeApps", () => {
  it("rejects a protected package without touching the TV", async () => {
    const adb = mockAdb();
    const spy = vi.spyOn(adb, "removeForUser");
    await expect(removeApps(adb, newLog(), ["com.amazon.tv.launcher"])).rejects.toBeInstanceOf(RejectedError);
    expect(spy).not.toHaveBeenCalled();
  });
  it("rejects packages not on the curated list", async () => {
    const adb = mockAdb();
    await expect(removeApps(adb, newLog(), ["com.example.other"])).rejects.toBeInstanceOf(RejectedError);
  });
  it("rejects invalid package names", async () => {
    const adb = mockAdb();
    await expect(removeApps(adb, newLog(), ["com.x; rm -rf /"])).rejects.toBeInstanceOf(RejectedError);
  });
  it("skips curated packages that are not installed", async () => {
    const adb = mockAdb({ installedPackages: async () => ["com.amazon.tv.csapp"] });
    const r = await removeApps(adb, newLog(), ["com.amazon.tv.csapp", "com.amazon.ags.app"]);
    expect(r.removed).toEqual(["com.amazon.tv.csapp"]);
    expect(r.skipped.map((s) => s.pkg)).toEqual(["com.amazon.ags.app"]);
  });
  it("stops mid-batch when the TV drops and reports exactly what happened", async () => {
    let n = 0;
    const adb = mockAdb({
      removeForUser: async () => { if (++n === 2) throw new AdbError("offline", "device offline"); },
    });
    const log = newLog();
    const r = await removeApps(adb, log, ["com.amazon.tv.csapp", "com.amazon.ags.app", "com.amazon.recess"]);
    expect(r.removed).toEqual(["com.amazon.tv.csapp"]);
    expect(r.failed?.pkg).toBe("com.amazon.ags.app");
    expect(r.notAttempted).toEqual(["com.amazon.recess"]);
    expect(log.entries().map((e) => e.pkg)).toEqual(["com.amazon.tv.csapp"]);
  });
  it("records each success in the log", async () => {
    const log = newLog();
    await removeApps(mockAdb(), log, ["com.amazon.tv.csapp"]);
    expect(log.entries().map((e) => e.pkg)).toEqual(["com.amazon.tv.csapp"]);
  });
});

describe("restoreApps", () => {
  it("restores a package the TV reports removed even if the log lost it", async () => {
    const restored: string[] = [];
    const adb = mockAdb({
      removedPackages: async () => ["com.amazon.tv.csapp"],
      restore: async (p) => { restored.push(p); },
    });
    const out = (await restoreApps(adb, newLog(), ["com.amazon.tv.csapp"])).restored;
    expect(out).toEqual(["com.amazon.tv.csapp"]);
    expect(restored).toEqual(["com.amazon.tv.csapp"]);
  });
  it("clears restored packages from the log", async () => {
    const log = newLog();
    log.record("com.amazon.tv.csapp");
    const adb = mockAdb({ removedPackages: async () => ["com.amazon.tv.csapp"] });
    await restoreApps(adb, log, ["com.amazon.tv.csapp"]);
    expect(log.entries()).toEqual([]);
  });
});

describe("review fixes", () => {
  it("stops the batch when the TV becomes unauthorized", async () => {
    let n = 0;
    const adb = mockAdb({ removeForUser: async () => { if (++n === 1) throw new AdbError("unauthorized", "revoked"); } });
    const r = await removeApps(adb, newLog(), ["com.amazon.tv.csapp", "com.amazon.ags.app"]);
    expect(r.failed?.pkg).toBe("com.amazon.tv.csapp");
    expect(r.notAttempted).toEqual(["com.amazon.ags.app"]);
  });
  it("reports a pm refusal as an error, not as skipped, and keeps going", async () => {
    const adb = mockAdb({ removeForUser: async (p) => { if (p === "com.amazon.tv.csapp") throw new AdbError("failed", "Failure [DELETE_FAILED_INTERNAL_ERROR]"); } });
    const r = await removeApps(adb, newLog(), ["com.amazon.tv.csapp", "com.amazon.ags.app"]);
    expect(r.errors.map((e) => e.pkg)).toEqual(["com.amazon.tv.csapp"]);
    expect(r.skipped).toEqual([]);
    expect(r.removed).toEqual(["com.amazon.ags.app"]);
  });
  it("lists not-installed apps as skipped even after a disconnect", async () => {
    const adb = mockAdb({
      installedPackages: async () => ["com.amazon.tv.csapp"],
      removeForUser: async () => { throw new AdbError("offline", "gone"); },
    });
    const r = await removeApps(adb, newLog(), ["com.amazon.tv.csapp", "com.amazon.ags.app"]);
    expect(r.skipped.map((s) => s.pkg)).toEqual(["com.amazon.ags.app"]);
  });
  it("removes a duplicated package only once", async () => {
    const adb = mockAdb();
    const r = await removeApps(adb, newLog(), ["com.amazon.tv.csapp", "com.amazon.tv.csapp"]);
    expect(adb.removed).toEqual(["com.amazon.tv.csapp"]);
    expect(r.removed).toEqual(["com.amazon.tv.csapp"]);
  });
  it("restoreApps reports a partial result when the TV drops mid-undo", async () => {
    let n = 0;
    const adb = mockAdb({
      removedPackages: async () => ["com.amazon.tv.csapp", "com.amazon.ags.app"],
      restore: async () => { if (++n === 2) throw new AdbError("offline", "gone"); },
    });
    const r = await restoreApps(adb, newLog(), ["com.amazon.tv.csapp", "com.amazon.ags.app"]);
    expect(r.restored).toEqual(["com.amazon.tv.csapp"]);
    expect(r.failed?.pkg).toBe("com.amazon.ags.app");
  });
  it("restoreApps rejects packages that are not on the curated list", async () => {
    await expect(restoreApps(mockAdb(), newLog(), ["com.example.other"])).rejects.toBeInstanceOf(RejectedError);
  });
});
