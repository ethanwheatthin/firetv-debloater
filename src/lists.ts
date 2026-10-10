import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CuratedApp } from "./types.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataDir, file), "utf8")) as T;
}

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export function isValidPackageName(s: string): boolean {
  return PACKAGE_RE.test(s);
}

export function loadCurated(): CuratedApp[] {
  return readJson<CuratedApp[]>("curated.json");
}

export function isProtected(pkg: string): boolean {
  const entries = readJson<string[]>("protected.json");
  return entries.some((e) => (e.endsWith("*") ? pkg.startsWith(e.slice(0, -1)) : pkg === e));
}
