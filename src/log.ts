import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Mode = "remove" | "disable";

export interface LogEntry { pkg: string; at: string; mode: Mode }

export interface Log {
  record(pkg: string, mode?: Mode): void;
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
    record(pkg, mode = "remove") {
      const rest = read().filter((e) => e.pkg !== pkg);
      write([...rest, { pkg, at: new Date().toISOString(), mode }]);
    },
    entries: read,
    clear(pkg) { write(read().filter((e) => e.pkg !== pkg)); },
  };
}
