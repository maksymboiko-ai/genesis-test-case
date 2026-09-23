import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDef } from "./openrouter.js";

const execAsync = promisify(exec);
const MAX_OUTPUT_CHARS = 4000;
const TIMEOUT_MS = 30_000;

// Coarse safety net for the eval sandbox: the model only ever needs npm/node
// commands here. Block anything destructive or that reaches outside the
// skill directory (the eval harness's own scope, not a general sandbox).
const DENY_PATTERNS = [/rm\s+-rf/i, /\bdel\b/i, /format\s+[a-z]:/i, />\s*\/dev\/(sd|nvme)/i, /curl|wget/i];

export const bashTool: ToolDef = {
  type: "function",
  function: {
    name: "bash",
    description:
      "Run a shell command in the wikipedia-trends skill directory (cwd is fixed there). Use this to install deps, build, and run the CLI.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run." },
      },
      required: ["command"],
    },
  },
};

export function makeBashExecutor(cwd: string) {
  return async function executeBash(command: string): Promise<string> {
    if (DENY_PATTERNS.some((p) => p.test(command))) {
      return "Error: command blocked by eval sandbox policy (destructive or network-fetching commands aren't allowed here).";
    }
    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 });
      const combined = [stdout, stderr].filter(Boolean).join("\n---stderr---\n");
      return combined.length > MAX_OUTPUT_CHARS
        ? combined.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]"
        : combined || "(no output)";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Command failed: ${message.slice(0, MAX_OUTPUT_CHARS)}`;
    }
  };
}
