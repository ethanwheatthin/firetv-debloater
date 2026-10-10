import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface LogEntry { pkg: string; at: string }

export interface Log {
  record(pkg: string): void;
  entries(): LogEntry[];
  clear(pkg: string): void;
}

export function createLog(filePath: string): Log {
  const read = (): LogEntry[] => {
    try { return JSON.parse(readFileSync(filePath, "utf8")) as LogEntry[]; } catch { return []; }
  };
  const write = (entries: LogEntry[]) => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(entries, null, 2));
  };
  return {
    record(pkg) {
      const rest = read().filter((e) => e.pkg !== pkg);
      write([...rest, { pkg, at: new Date().toISOString() }]);
    },
    entries: read,
    clear(pkg) { write(read().filter((e) => e.pkg !== pkg)); },
  };
}
