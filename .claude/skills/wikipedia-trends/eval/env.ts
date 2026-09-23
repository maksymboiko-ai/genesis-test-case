import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Minimal .env loader (no dependency) — only ever reads from the gitignored local file. */
export function loadEnvFile(path = join(import.meta.dirname, "..", ".env")): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
