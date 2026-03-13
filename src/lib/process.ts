import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  maxMode?: boolean;
}

export interface RunStreamingOptions extends RunOptions {
  onLine: (line: string) => void;
}

/**
 * If the agent path is a .cmd wrapper (like Cursor's agent.cmd),
 * resolve to the underlying node.exe + index.js in the same directory
 * to bypass cmd.exe. This avoids issues with special characters
 * (<, >, &, |, newlines) in arguments being misinterpreted by cmd.exe.
 */
function resolveAgent(agentPath: string): { cmd: string; prefixArgs: string[] } {
  let resolved = agentPath;

  // Resolve bare command names (e.g. "agent") to full path via PATH lookup
  if (process.platform === "win32" && !path.isAbsolute(agentPath) && !agentPath.includes(path.sep)) {
    for (const ext of [".cmd", ".exe", ""]) {
      const candidate = agentPath + ext;
      for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        const full = path.join(dir, candidate);
        if (fs.existsSync(full)) { resolved = full; break; }
      }
      if (resolved !== agentPath) break;
    }
  }

  if (process.platform === "win32" && /\.cmd$/i.test(resolved)) {
    const dir = path.dirname(path.resolve(resolved));
    const nodeBin = path.join(dir, "node.exe");
    const script = path.join(dir, "index.js");
    if (fs.existsSync(nodeBin) && fs.existsSync(script)) {
      return { cmd: nodeBin, prefixArgs: [script] };
    }
  }
  return { cmd: resolved, prefixArgs: [] };
}

const PREFLIGHT_SCRIPT = path.join(__dirname, "max-mode-preflight.js");

function applyMaxModePreflight(resolved: { cmd: string; prefixArgs: string[] }): void {
  const nodeBin = resolved.prefixArgs.length > 0 ? resolved.cmd : undefined;
  if (!nodeBin) return;

  const agentScript = resolved.prefixArgs[0] ?? "";
  try {
    execFileSync(nodeBin, [PREFLIGHT_SCRIPT, agentScript], {
      timeout: 3000,
      stdio: "ignore",
    });
  } catch {
    /* best-effort */
  }
}

function spawnAgent(cmd: string, args: string[], opts?: { cwd?: string; maxMode?: boolean }) {
  const resolved = resolveAgent(cmd);

  if (opts?.maxMode) {
    applyMaxModePreflight(resolved);
  }

  const fullArgs = [...resolved.prefixArgs, ...args];

  const env: Record<string, string | undefined> = {
    ...process.env,
    CURSOR_INVOKED_AS: "agent.cmd",
  };

  // Ensure CURSOR_CONFIG_DIR points to the agent's config directory
  // so the CLI reads the same cli-config.json the preflight wrote to.
  if (!env.CURSOR_CONFIG_DIR && resolved.prefixArgs.length > 0) {
    const agentDir = path.dirname(path.resolve(resolved.prefixArgs[0]));
    const configDir = path.join(agentDir, "..", "data", "config");
    if (fs.existsSync(path.join(configDir, "cli-config.json"))) {
      env.CURSOR_CONFIG_DIR = configDir;
    }
  }

  return spawn(resolved.cmd, fullArgs, {
    cwd: opts?.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function runStreaming(
  cmd: string,
  args: string[],
  opts: RunStreamingOptions,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnAgent(cmd, args, { cwd: opts.cwd, maxMode: opts.maxMode });

    const timeout =
      typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
        ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
        : undefined;

    let stderr = "";
    let lineBuffer = "";

    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (c: string) => (stderr += c));

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) opts.onLine(line);
      }
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (timeout) clearTimeout(timeout);
      if (err?.code === "ENOENT") {
        reject(
          new Error(
            `Cursor CLI not found: "${cmd}". ` +
              "Install it via https://docs.cursor.com/cli or set cursorBridge.agentPath in settings.",
          ),
        );
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (lineBuffer.trim()) opts.onLine(lineBuffer.trim());
      resolve({ code: code ?? 0, stderr });
    });
  });
}

export function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawnAgent(cmd, args, { cwd: opts.cwd, maxMode: opts.maxMode });

    const timeout =
      typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
        ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
        : undefined;

    let stdout = "";
    let stderr = "";

    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (c: string) => (stdout += c));
    child.stderr!.on("data", (c: string) => (stderr += c));

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (timeout) clearTimeout(timeout);
      if (err?.code === "ENOENT") {
        reject(
          new Error(
            `Cursor CLI not found: "${cmd}". ` +
              "Install it via https://docs.cursor.com/cli or set cursorBridge.agentPath in settings.",
          ),
        );
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}
