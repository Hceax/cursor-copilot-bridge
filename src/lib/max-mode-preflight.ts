/**
 * Standalone preflight script executed by node.exe before the agent CLI.
 * Sets maxMode=true in cli-config.json so the CLI picks it up.
 *
 * Usage: node.exe max-mode-preflight.js <path-to-agent-index.js>
 *
 * Config resolution order:
 *   1. $CURSOR_CONFIG_DIR/cli-config.json
 *   2. <agent-dir>/../data/config/cli-config.json  (CursorToolkit layout)
 *   3. Platform default (LOCALAPPDATA / Library / XDG)
 */

import * as fs from "node:fs";
import * as path from "node:path";

function getCandidates(): string[] {
  const result: string[] = [];

  if (process.env.CURSOR_CONFIG_DIR) {
    result.push(path.join(process.env.CURSOR_CONFIG_DIR, "cli-config.json"));
  }

  const agentScript = process.argv[2];
  if (agentScript) {
    const agentDir = path.dirname(path.resolve(agentScript));
    result.push(path.join(agentDir, "..", "data", "config", "cli-config.json"));
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    result.push(path.join(local, "cursor-agent", "cli-config.json"));
  } else if (process.platform === "darwin") {
    result.push(path.join(home, "Library", "Application Support", "cursor-agent", "cli-config.json"));
  } else {
    const xdg = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
    result.push(path.join(xdg, "cursor-agent", "cli-config.json"));
  }

  return result;
}

for (const candidate of getCandidates()) {
  try {
    const rawStr = fs.readFileSync(candidate, "utf-8");
    const raw = JSON.parse(rawStr.replace(/^\uFEFF/, ""));
    if (!raw || typeof raw !== "object" || Object.keys(raw).length <= 1) continue;

    raw.maxMode = true;
    if (typeof raw.model === "object" && raw.model) {
      raw.model.maxMode = true;
    }
    fs.writeFileSync(candidate, JSON.stringify(raw, null, 2), "utf-8");
    break;
  } catch {
    /* candidate not found or unreadable — try next */
  }
}
