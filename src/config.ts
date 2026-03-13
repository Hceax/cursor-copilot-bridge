import * as vscode from "vscode";

export interface BridgeConfig {
  apiKey: string;
  agentPath: string;
  defaultModel: string;
  force: boolean;
  approveMcps: boolean;
  sandbox: "" | "enabled" | "disabled";
  customHeaders: string[];
  sessionTtlMs: number;
  maxHistoryTurns: number;
  timeoutMs: number;
  maxMode: boolean;
  verbose: boolean;
}

export function loadConfig(): BridgeConfig {
  const cfg = vscode.workspace.getConfiguration("cursorBridge");
  return {
    apiKey: cfg.get<string>("apiKey", ""),
    agentPath: cfg.get<string>("agentPath", "agent"),
    defaultModel: cfg.get<string>("defaultModel", ""),
    force: cfg.get<boolean>("force", true),
    approveMcps: cfg.get<boolean>("approveMcps", false),
    sandbox: cfg.get<"" | "enabled" | "disabled">("sandbox", ""),
    customHeaders: cfg.get<string[]>("customHeaders", []),
    sessionTtlMs: cfg.get<number>("sessionTtlMinutes", 30) * 60_000,
    maxHistoryTurns: cfg.get<number>("maxHistoryTurns", 10),
    timeoutMs: cfg.get<number>("timeoutSeconds", 300) * 1000,
    maxMode: cfg.get<boolean>("maxMode", false),
    verbose: cfg.get<boolean>("verbose", false),
  };
}

