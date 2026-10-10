import { describe, it, expect } from "vitest";
import { discover } from "../src/discover.js";

describe("discover", () => {
  it("finds hosts in the local /24 and never probes outside it", async () => {
    const probed: string[] = [];
    const found = await discover({
      localIps: ["192.168.1.10"],
      probe: async (ip) => { probed.push(ip); return ip === "192.168.1.42"; },
    });
    expect(found).toEqual(["192.168.1.42"]);
    expect(probed.every((ip) => ip.startsWith("192.168.1."))).toBe(true);
    expect(probed).not.toContain("192.168.1.10");
    expect(probed.length).toBe(253);
  });
  it("returns nothing when there are no local IPs", async () => {
    expect(await discover({ localIps: [], probe: async () => true })).toEqual([]);
  });
});
