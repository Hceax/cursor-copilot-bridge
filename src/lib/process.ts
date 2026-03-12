import { spawn } from "node:child_process";
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
  if (process.platform === "win32" && /\.cmd$/i.test(agentPath)) {
    const dir = path.dirname(path.resolve(agentPath));
    const nodeBin = path.join(dir, "node.exe");
    const script = path.join(dir, "index.js");
    if (fs.existsSync(nodeBin) && fs.existsSync(script)) {
      return {
        cmd: nodeBin,
        prefixArgs: [script],
      };
    }
  }
  return { cmd: agentPath, prefixArgs: [] };
}

function spawnAgent(cmd: string, args: string[], cwd?: string) {
  const resolved = resolveAgent(cmd);
  const fullArgs = [...resolved.prefixArgs, ...args];
  const env = {
    ...process.env,
    CURSOR_INVOKED_AS: "agent.cmd",
  };

  return spawn(resolved.cmd, fullArgs, {
    cwd,
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
    const child = spawnAgent(cmd, args, opts.cwd);

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
    const child = spawnAgent(cmd, args, opts.cwd);

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
