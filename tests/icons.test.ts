import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { getIcon } from "../src/icons.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dir = () => mkdtempSync(join(tmpdir(), "ftv-icons-"));

describe("getIcon", () => {
  it("returns the largest launcher PNG in the APK", async () => {
    const apk = zipSync({
      "res/mipmap-mdpi/ic_launcher.png": enc("small"),
      "res/mipmap-xxhdpi/ic_launcher.png": enc("the-biggest-icon-bytes"),
      "res/drawable/background.png": enc("x".repeat(500)),
    });
    const icon = await getIcon(async () => apk, "com.a.b", dir());
    expect(icon?.toString()).toBe("the-biggest-icon-bytes");
  });
  it("returns null when only XML icons exist", async () => {
    const apk = zipSync({ "res/mipmap-anydpi-v26/ic_launcher.xml": enc("<adaptive-icon/>") });
    expect(await getIcon(async () => apk, "com.a.b", dir())).toBeNull();
  });
  it("returns null when the pull fails", async () => {
    expect(await getIcon(async () => { throw new Error("nope"); }, "com.a.b", dir())).toBeNull();
  });
  it("caches by package so the TV is only asked once", async () => {
    const apk = zipSync({ "res/mipmap-hdpi/ic_launcher.png": enc("icon") });
    const pull = vi.fn(async () => apk);
    const d = dir();
    await getIcon(pull, "com.a.b", d);
    await getIcon(pull, "com.a.b", d);
    expect(pull).toHaveBeenCalledTimes(1);
  });
});
