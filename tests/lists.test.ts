import { describe, it, expect } from "vitest";
import { loadCurated, isProtected, isValidPackageName } from "../src/lists.js";

describe("isValidPackageName", () => {
  it("accepts normal package names", () => {
    expect(isValidPackageName("com.amazon.foo")).toBe(true);
    expect(isValidPackageName("com.amazon.tv_launcher2")).toBe(true);
  });
  it("rejects shell metacharacters and empty strings", () => {
    expect(isValidPackageName("com.x; rm -rf /")).toBe(false);
    expect(isValidPackageName("com.x$(id)")).toBe(false);
    expect(isValidPackageName("")).toBe(false);
    expect(isValidPackageName("nodots")).toBe(false);
  });
});

describe("isProtected", () => {
  it("protects the launcher and prefix-matched system packages", () => {
    expect(isProtected("com.amazon.tv.launcher")).toBe(true);
    expect(isProtected("com.amazon.device.something")).toBe(true);
    expect(isProtected("android")).toBe(true);
  });
  it("does not protect an ordinary app", () => {
    expect(isProtected("com.example.randomapp")).toBe(false);
  });
});

describe("curated list", () => {
  const apps = loadCurated();
  it("is non-empty with unique packages", () => {
    expect(apps.length).toBeGreaterThan(0);
    expect(new Set(apps.map((a) => a.pkg)).size).toBe(apps.length);
  });
  it("never contains a protected or invalid package", () => {
    for (const a of apps) {
      expect(isProtected(a.pkg), a.pkg).toBe(false);
      expect(isValidPackageName(a.pkg), a.pkg).toBe(true);
    }
  });
  it("marks every entry unverified with an explanation and valid tag", () => {
    for (const a of apps) {
      expect(a.verified).toBe(false);
      expect(a.explanation.length).toBeGreaterThan(0);
      expect(["safe", "loses-feature", "not-recommended"]).toContain(a.tag);
    }
  });
});
