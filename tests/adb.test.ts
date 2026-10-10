import { describe, it, expect } from "vitest";
import { createAdb, AdbError, type Exec } from "../src/adb.js";

function fake(responses: Record<string, { stdout: string; code?: number }>) {
  const calls: string[][] = [];
  const exec: Exec = async (args) => {
    calls.push(args);
    const r = responses[args.join(" ")] ?? { stdout: "" };
    return { stdout: r.stdout, stderr: "", code: r.code ?? 0 };
  };
  return { exec, calls };
}

describe("connect", () => {
  it("runs adb connect host:5555", async () => {
    const { exec, calls } = fake({ "connect 192.168.1.5:5555": { stdout: "connected to 192.168.1.5:5555" } });
    await createAdb(exec).connect("192.168.1.5");
    expect(calls[0]).toEqual(["connect", "192.168.1.5:5555"]);
  });
  it("throws unauthorized when the TV has not approved this computer", async () => {
    const { exec } = fake({ "connect 192.168.1.5:5555": { stdout: "failed to authenticate to 192.168.1.5:5555" } });
    await expect(createAdb(exec).connect("192.168.1.5")).rejects.toMatchObject({ kind: "unauthorized" });
  });
  it("throws unauthorized on 'unauthorized' output", async () => {
    const { exec } = fake({ "connect 192.168.1.5:5555": { stdout: "connected to 192.168.1.5:5555\n" }, "-s 192.168.1.5:5555 get-state": { stdout: "unauthorized" } });
    await expect(createAdb(exec).connect("192.168.1.5")).rejects.toMatchObject({ kind: "unauthorized" });
  });
  it("throws offline when it cannot connect", async () => {
    const { exec } = fake({ "connect 192.168.1.5:5555": { stdout: "cannot connect to 192.168.1.5:5555: Connection refused" } });
    await expect(createAdb(exec).connect("192.168.1.5")).rejects.toMatchObject({ kind: "offline" });
  });
  it("rejects a host that is not an IPv4 address or hostname before running adb", async () => {
    const { exec, calls } = fake({});
    await expect(createAdb(exec).connect("1.2.3.4; reboot")).rejects.toBeInstanceOf(AdbError);
    expect(calls.length).toBe(0);
  });
});

describe("package listing", () => {
  it("parses installed packages", async () => {
    const { exec } = fake({ "shell pm list packages --user 0": { stdout: "package:com.a.b\npackage:com.c.d\n" } });
    expect(await createAdb(exec).installedPackages()).toEqual(["com.a.b", "com.c.d"]);
  });
  it("computes removed packages as `-u` minus installed", async () => {
    const { exec } = fake({
      "shell pm list packages --user 0": { stdout: "package:com.a.b\n" },
      "shell pm list packages -u --user 0": { stdout: "package:com.a.b\npackage:com.c.d\n" },
    });
    expect(await createAdb(exec).removedPackages()).toEqual(["com.c.d"]);
  });
});

describe("removeForUser / restore", () => {
  it("runs pm uninstall -k --user 0 and requires Success", async () => {
    const { exec, calls } = fake({ "shell pm uninstall -k --user 0 com.a.b": { stdout: "Success\n" } });
    await createAdb(exec).removeForUser("com.a.b");
    expect(calls[0]).toEqual(["shell", "pm", "uninstall", "-k", "--user", "0", "com.a.b"]);
  });
  it("throws failed when output is not Success", async () => {
    const { exec } = fake({ "shell pm uninstall -k --user 0 com.a.b": { stdout: "Failure [DELETE_FAILED_DEVICE_POLICY_MANAGER]" } });
    await expect(createAdb(exec).removeForUser("com.a.b")).rejects.toMatchObject({ kind: "failed" });
  });
  it("restores with cmd package install-existing", async () => {
    const { exec, calls } = fake({ "shell cmd package install-existing --user 0 com.a.b": { stdout: "Package com.a.b installed for user: 0" } });
    await createAdb(exec).restore("com.a.b");
    expect(calls[0]).toEqual(["shell", "cmd", "package", "install-existing", "--user", "0", "com.a.b"]);
  });
  it("rejects invalid package names before calling exec", async () => {
    const { exec, calls } = fake({});
    const adb = createAdb(exec);
    await expect(adb.removeForUser("com.x; rm -rf /")).rejects.toBeInstanceOf(AdbError);
    await expect(adb.restore("bad name")).rejects.toBeInstanceOf(AdbError);
    expect(calls.length).toBe(0);
  });
  it("maps a dropped connection to offline", async () => {
    const { exec } = fake({ "shell pm uninstall -k --user 0 com.a.b": { stdout: "error: device offline", code: 1 } });
    await expect(createAdb(exec).removeForUser("com.a.b")).rejects.toMatchObject({ kind: "offline" });
  });
});

describe("review fixes: errors, serial, listings", () => {
  it("treats a dead/hung connection (no output, non-zero code) as offline when removing", async () => {
    const { exec } = fake({ "shell pm uninstall -k --user 0 com.a.b": { stdout: "", code: -1 } });
    await expect(createAdb(exec).removeForUser("com.a.b")).rejects.toMatchObject({ kind: "offline" });
  });
  it("throws when the package listing fails instead of returning an empty list", async () => {
    const { exec } = fake({ "shell pm list packages --user 0": { stdout: "error: device offline", code: 1 } });
    await expect(createAdb(exec).installedPackages()).rejects.toMatchObject({ kind: "offline" });
  });
  it("throws when the package listing comes back empty", async () => {
    const { exec } = fake({ "shell pm list packages --user 0": { stdout: "" } });
    await expect(createAdb(exec).installedPackages()).rejects.toBeInstanceOf(AdbError);
  });
  it("does not report everything as removed when the installed listing fails", async () => {
    const { exec } = fake({
      "shell pm list packages -u --user 0": { stdout: "package:com.a.b\n" },
      "shell pm list packages --user 0": { stdout: "", code: 1 },
    });
    await expect(createAdb(exec).removedPackages()).rejects.toBeInstanceOf(AdbError);
  });
  it("targets the connected device with -s on every later command", async () => {
    const { exec, calls } = fake({ "-s 192.168.1.5:5555 shell pm uninstall -k --user 0 com.a.b": { stdout: "Success" } });
    const adb = createAdb(exec);
    await adb.connect("192.168.1.5");
    await adb.removeForUser("com.a.b");
    expect(calls[calls.length - 1]).toEqual(["-s", "192.168.1.5:5555", "shell", "pm", "uninstall", "-k", "--user", "0", "com.a.b"]);
  });
});
