import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";

export async function getIcon(
  pull: (pkg: string) => Promise<Uint8Array>,
  pkg: string,
  cacheDir: string,
): Promise<Buffer | null> {
  const cached = join(cacheDir, `${pkg}.png`);
  const miss = join(cacheDir, `${pkg}.none`);
  try { return await readFile(cached); } catch { /* not cached */ }
  try { await readFile(miss); return null; } catch { /* not cached */ }

  let result: Buffer | null = null;
  try {
    const files = unzipSync(await pull(pkg), {
      filter: (f) => /^res\/.*\.png$/i.test(f.name) && /ic_launcher|icon/i.test(f.name),
    });
    let best: Uint8Array | null = null;
    for (const data of Object.values(files)) if (!best || data.length > best.length) best = data;
    if (best) result = Buffer.from(best);
  } catch {
    return null; // transient failure: don't cache
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(result ? cached : miss, result ?? "");
  return result;
}
