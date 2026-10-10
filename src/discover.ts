import net from "node:net";
import os from "node:os";

export interface DiscoverOptions {
  localIps: string[];
  probe: (ip: string) => Promise<boolean>;
}

export async function discover({ localIps, probe }: DiscoverOptions): Promise<string[]> {
  const found: string[] = [];
  for (const local of localIps) {
    const prefix = local.split(".").slice(0, 3).join(".");
    const last = Number(local.split(".")[3]);
    const candidates: string[] = [];
    for (let i = 1; i <= 254; i++) if (i !== last) candidates.push(`${prefix}.${i}`);
    const results = await Promise.all(candidates.map(async (ip) => ((await probe(ip)) ? ip : null)));
    for (const ip of results) if (ip && !found.includes(ip)) found.push(ip);
  }
  return found;
}

export function localIPv4(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((i) => i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

export function probePort5555(ip: string, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port: 5555 });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}
