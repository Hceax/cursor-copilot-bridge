import * as vscode from "vscode";
import type { BridgeConfig } from "./config.js";
import { buildAgentCmdArgs } from "./lib/agent-cmd-args.js";
import { createStreamParser } from "./lib/cli-stream-parser.js";
import { run, runStreaming } from "./lib/process.js";
import { SessionManager } from "./lib/session-manager.js";
import {
  buildNewSessionPrompt,
  convertMessages,
  findLastUserMessage,
} from "./message-converter.js";
import { log, logVerbose } from "./log.js";

export interface ModelInfo {
  id: string;
  name: string;
}

export class CursorBridgeProvider implements vscode.LanguageModelChatProvider {
  private sessionManager: SessionManager;
  private cachedModels: ModelInfo[] = [];
  constructor(
    private getConfig: () => BridgeConfig,
  ) {
    const config = getConfig();
    this.sessionManager = new SessionManager(config.sessionTtlMs);
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const config = this.getConfig();

    if (!options.silent || this.cachedModels.length === 0) {
      try {
        this.cachedModels = await this.fetchModels(config);
        log(`Discovered ${this.cachedModels.length} models from Cursor CLI`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Failed to list models: ${msg}`);

        if (this.cachedModels.length === 0 && !options.silent) {
          vscode.window.showErrorMessage(
            `Cursor Bridge: Cannot list models. ${msg}`,
          );
        }
      }
    }

    if (this.cachedModels.length === 0) {
      return [this.fallbackModel()];
    }

    return this.cachedModels.map((m) => toModelInfo(m));
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const config = this.getConfig();

    const reply = (text: string) => {
      try {
        progress.report(new vscode.LanguageModelTextPart(text));
      } catch { /* disposed */ }
    };

    const replyError = (title: string, detail: string, hints: string[]) => {
      const lines = [`**⚠️ Cursor Bridge Error: ${title}**`, "", detail];
      if (hints.length > 0) {
        lines.push("", "**How to fix:**");
        for (const h of hints) lines.push(`- ${h}`);
      }
      lines.push("", "_Open Output → Cursor Bridge for full logs._");
      reply(lines.join("\n"));
    };

    let normalized;
    try {
      normalized = convertMessages(messages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Message conversion failed: ${msg}`);
      replyError("Message Conversion Failed", msg, [
        "This is likely a bug. Please report it on GitHub.",
      ]);
      return;
    }

    const lastUser = findLastUserMessage(normalized);
    if (!lastUser) {
      log("No user message found in request");
      replyError(
        "No User Message",
        "Could not find any user message in the request.",
        ["Try sending your message again."],
      );
      return;
    }

    log(`Request: model=${model.id}, ${normalized.length} msgs, lastUser="${lastUser.slice(0, 80)}"`);
    log(`Options keys: ${Object.keys(options).join(", ")}`);
    logVerbose(config.verbose, `Options dump: ${JSON.stringify(options, (_, v) => typeof v === "function" ? "[fn]" : Array.isArray(v) ? `[Array(${v.length})]` : v, 0)}`);

    const toolNames = Array.isArray(options.tools)
      ? options.tools.map((t: any) => t.name ?? "?")
      : [];
    const hasWriteTools = toolNames.some((n) => WRITE_TOOL_NAMES.has(n));
    const detectedMode: "agent" | "ask" = hasWriteTools ? "agent" : "ask";

    log(`Mode detection: ${toolNames.length} tools (write=${hasWriteTools}) → ${detectedMode} mode`);
    logVerbose(config.verbose, `Tool names: ${toolNames.join(", ") || "none"}`);

    const workspaceDir =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    let session;
    try {
      session = await this.sessionManager.processRequest(
        config, normalized, lastUser, detectedMode,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Session creation failed: ${msg}`);
      replyError(
        "Session Creation Failed",
        `Could not create a Cursor CLI chat session.\n\n\`${msg}\``,
        [
          "Check that the Cursor CLI is installed and accessible at the configured path.",
          "Run `agent status` in a terminal to verify authentication.",
          `Current path: \`${config.agentPath}\``,
        ],
      );
      return;
    }

    const prompt = session.isNew
      ? buildNewSessionPrompt(normalized, config.maxHistoryTurns)
      : session.lastUserMessage;

    const { args: cmdArgs, mode: resolvedMode } = buildAgentCmdArgs({
      config, workspaceDir,
      model: model.id, prompt,
      stream: true, hasTools: hasWriteTools,
      chatId: session.chatId,
      apiKey: config.apiKey || undefined,
    });

    log(`CLI mode=${resolvedMode}, args: ${cmdArgs.map(a => a.length > 60 ? a.slice(0, 60) + "..." : a).join(" ")}`);

    return new Promise<void>((resolve) => {
      if (token.isCancellationRequested) {
        resolve();
        return;
      }

      let hasOutput = false;

      const replyThinking = (text: string) => {
        try {
          (progress as vscode.Progress<any>).report(new vscode.LanguageModelThinkingPart(text));
        } catch { /* disposed or unsupported */ }
      };

      const parseLine = createStreamParser({
        onText: (text) => {
          hasOutput = true;
          reply(text);
        },
        onDone: () => {
          logVerbose(config.verbose, "CLI stream completed");
        },
        onThinkingDelta: (text) => {
          hasOutput = true;
          replyThinking(text);
        },
        onThinkingDone: () => {
          logVerbose(config.verbose, "CLI thinking completed");
        },
        onSessionInit: (info) => {
          log(`CLI session: id=${info.sessionId}, model=${info.model}, mode=${info.permissionMode}`);
        },
        onToolCallStarted: (info) => {
          log(`Tool started: [${info.toolType}] ${info.description || info.callId}`);
        },
        onToolCallCompleted: (result) => {
          const status = result.success ? "ok" : "fail";
          const time = result.executionTimeMs != null ? ` (${result.executionTimeMs}ms)` : "";
          log(`Tool completed: [${result.toolType}] ${status}${time} ${result.description || result.callId}`);
        },
        onUsage: (stats) => {
          const parts: string[] = [];
          if (stats.inputTokens != null) parts.push(`in=${stats.inputTokens}`);
          if (stats.outputTokens != null) parts.push(`out=${stats.outputTokens}`);
          if (stats.cacheReadTokens != null) parts.push(`cache_r=${stats.cacheReadTokens}`);
          if (stats.cacheWriteTokens != null) parts.push(`cache_w=${stats.cacheWriteTokens}`);
          if (stats.durationMs != null) parts.push(`${(stats.durationMs / 1000).toFixed(1)}s`);
          log(`Usage: ${parts.join(", ")}`);
        },
      });

      const cancelListener = token.onCancellationRequested(() => {
        log("Request cancelled by user");
      });

      runStreaming(config.agentPath, cmdArgs, {
        cwd: workspaceDir,
        timeoutMs: config.timeoutMs,
        maxMode: config.maxMode,
        onLine: (line) => {
          logVerbose(config.verbose, `CLI: ${line.slice(0, 150)}`);
          parseLine(line);
        },
      })
        .then(({ code, stderr }) => {
          cancelListener.dispose();

          if (token.isCancellationRequested) {
            resolve();
            return;
          }

          if (code === 0) {
            if (!hasOutput) {
              replyError(
                "Empty Response",
                "The Cursor CLI completed successfully but returned no content.",
                ["Try a different model or rephrase your question."],
              );
            }
            log(`CLI completed (code 0, hasOutput=${hasOutput})`);
            resolve();
            return;
          }

          const stderrText = stderr.trim();
          log(`CLI exited with code ${code}, stderr: ${stderrText.slice(0, 500) || "(empty)"}`);

          const { title, detail, hints } = diagnoseCliError(code, stderrText, config);
          replyError(title, detail, hints);
          resolve();
        })
        .catch((err) => {
          cancelListener.dispose();
          const msg = err instanceof Error ? err.message : String(err);
          log(`CLI spawn error: ${msg}`);

          if (msg.includes("not found") || msg.includes("ENOENT")) {
            replyError(
              "Cursor CLI Not Found",
              `Cannot find the Cursor CLI binary at \`${config.agentPath}\`.`,
              [
                "Install the Cursor CLI: `irm 'https://cursor.com/install?win32=true' | iex`",
                "Or set `cursorBridge.agentPath` in Settings to the correct path.",
                "After installing, run `agent login` to authenticate.",
              ],
            );
          } else {
            replyError(
              "Process Error",
              `Failed to start the Cursor CLI.\n\n\`${msg}\``,
              [
                "Check that `cursorBridge.agentPath` points to a valid executable.",
                `Current path: \`${config.agentPath}\``,
              ],
            );
          }
          resolve();
        });
    });
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const str =
      typeof text === "string" ? text : textFromMessage(text);
    return Math.ceil(str.length / 4);
  }

  async refreshModels(): Promise<ModelInfo[]> {
    const config = this.getConfig();
    this.cachedModels = await this.fetchModels(config);
    return this.cachedModels;
  }

  getSessionCount(): number {
    return this.sessionManager.getActiveCount();
  }

  destroy(): void {
    this.sessionManager.destroy();
  }

  private async fetchModels(config: BridgeConfig): Promise<ModelInfo[]> {
    const result = await run(config.agentPath, ["--list-models"], {
      timeoutMs: 15_000,
    });

    if (result.code !== 0) {
      throw new Error(`agent --list-models failed: ${result.stderr.trim()}`);
    }

    return parseModelList(result.stdout);
  }

  private fallbackModel(): vscode.LanguageModelChatInformation {
    return toModelInfo({
      id: "auto",
      name: "Auto (Cursor Default)",
    });
  }
}

function diagnoseCliError(
  code: number,
  stderr: string,
  config: BridgeConfig,
): { title: string; detail: string; hints: string[] } {
  const lower = stderr.toLowerCase();

  if (code === null || code === 137 || code === -1) {
    return {
      title: "Request Timed Out",
      detail: `The Cursor CLI was killed after ${config.timeoutMs / 1000}s without completing.`,
      hints: [
        "Increase `cursorBridge.timeoutSeconds` in Settings.",
        "Try a simpler prompt or a faster model.",
      ],
    };
  }

  if (lower.includes("unauthorized") || lower.includes("auth") ||
      lower.includes("api key") || lower.includes("401") ||
      lower.includes("login") || lower.includes("not logged in")) {
    return {
      title: "Authentication Failed",
      detail: `The Cursor CLI rejected the request due to authentication.\n\n\`${stderr.slice(0, 300)}\``,
      hints: [
        "Set `cursorBridge.apiKey` in Settings with your Cursor API key.",
        "Or run `agent login` in a terminal to authenticate interactively.",
        "Get your API key from https://cursor.com/settings.",
      ],
    };
  }

  if (lower.includes("model") && (lower.includes("not found") || lower.includes("invalid") || lower.includes("unavailable"))) {
    return {
      title: "Invalid Model",
      detail: `The requested model is not available.\n\n\`${stderr.slice(0, 300)}\``,
      hints: [
        "Check the model name in the Copilot model picker.",
        "Run `Cursor Bridge: Refresh Available Models` to update the list.",
        "Your subscription may not include this model.",
      ],
    };
  }

  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many")) {
    return {
      title: "Rate Limited",
      detail: `You've hit Cursor's rate limit.\n\n\`${stderr.slice(0, 300)}\``,
      hints: [
        "Wait a moment and try again.",
        "Switch to a less busy model.",
      ],
    };
  }

  if (lower.includes("network") || lower.includes("econnrefused") ||
      lower.includes("enotfound") || lower.includes("timeout") ||
      lower.includes("fetch failed")) {
    return {
      title: "Network Error",
      detail: `The Cursor CLI could not connect to the server.\n\n\`${stderr.slice(0, 300)}\``,
      hints: [
        "Check your internet connection.",
        "Check if Cursor's API is experiencing downtime.",
      ],
    };
  }

  if (lower.includes("quota") || lower.includes("limit exceeded") || lower.includes("billing")) {
    return {
      title: "Quota Exceeded",
      detail: `Your Cursor usage quota has been exceeded.\n\n\`${stderr.slice(0, 300)}\``,
      hints: [
        "Check your usage at https://cursor.com/settings.",
        "Upgrade your subscription or wait for the quota to reset.",
      ],
    };
  }

  return {
    title: `CLI Error (exit code ${code})`,
    detail: stderr
      ? `The Cursor CLI exited unexpectedly.\n\n\`${stderr.slice(0, 400)}\``
      : "The Cursor CLI exited with an error but produced no error message.",
    hints: [
      "Enable `cursorBridge.verbose` in Settings and check the Cursor Bridge output channel.",
      `Agent path: \`${config.agentPath}\``,
      "Try running the same command manually in a terminal to see the full error.",
    ],
  };
}

const WRITE_TOOL_NAMES = new Set([
  "create_file", "create_directory", "create_new_jupyter_notebook",
  "create_new_workspace", "edit_notebook_file", "multi_replace_string_in_file",
  "replace_string_in_file", "run_in_terminal", "create_and_run_task",
  "run_notebook_cell", "run_vscode_command", "install_extension",
  "kill_terminal", "manage_todo_list",
]);

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:\[[0-9;]*[A-Za-z]|\].*?(?:\x07|\x1B\\))/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function parseModelList(output: string): ModelInfo[] {
  const lines = stripAnsi(output).split(/\r?\n/).map((l) => l.trim());
  const models: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9._:/-]*)\s+-\s+(.*)$/);
    if (!match) continue;

    const id = match[1];
    const raw = match[2];
    const name = raw
      .replace(/\s*\(current(?:,\s*default)?\)\s*/g, "")
      .replace(/\s*\(default\)\s*/g, "")
      .trim() || id;

    if (!seen.has(id)) {
      seen.add(id);
      models.push({ id, name });
    }
  }

  return models;
}

function toModelInfo(m: ModelInfo): vscode.LanguageModelChatInformation {
  return {
    id: m.id,
    name: m.name,
    family: "cursor",
    version: "1.0.0",
    maxInputTokens: 200000,
    maxOutputTokens: 16384,
    capabilities: {
      toolCalling: true,
      imageInput: false,
    },
  };
}

function textFromMessage(msg: vscode.LanguageModelChatRequestMessage): string {
  const parts: string[] = [];
  for (const part of msg.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      parts.push(part.value);
    }
  }
  return parts.join("");
}

