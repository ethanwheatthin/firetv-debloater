// Downloads Google's official Android platform-tools (which contains adb) into vendor/.
// Usage: npx tsx scripts/fetch-platform-tools.ts [windows|darwin|linux]
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";

const os = process.argv[2] ?? (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux");
if (!["windows", "darwin", "linux"].includes(os)) throw new Error(`Unknown OS: ${os}`);

// TODO(release): pin an exact version/checksum here once chosen. "latest" is used until then.
const url = `https://dl.google.com/android/repository/platform-tools-latest-${os}.zip`;
console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
const files = unzipSync(new Uint8Array(await res.arrayBuffer()));

const out = join(process.cwd(), "vendor");
for (const [name, data] of Object.entries(files)) {
  if (name.endsWith("/")) continue;
  const dest = join(out, name);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, data);
  if (os !== "windows" && /platform-tools\/(adb|fastboot)$/.test(name)) chmodSync(dest, 0o755);
}
console.log(`Installed to ${join(out, "platform-tools")}`);
