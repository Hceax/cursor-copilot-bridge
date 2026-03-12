import type { BridgeConfig } from "../config.js";

export interface AgentCmdOptions {
  config: BridgeConfig;
  workspaceDir: string;
  model?: string;
  prompt: string;
  stream: boolean;
  hasTools: boolean;
  chatId?: string;
  apiKey?: string;
}

export type ResolvedMode = "agent" | "ask";

export function buildAgentCmdArgs(opts: AgentCmdOptions): { args: string[]; mode: ResolvedMode } {
  const { config } = opts;
  const args: string[] = [];
  const mode: ResolvedMode = opts.hasTools ? "agent" : "ask";

  args.push("--print");

  if (mode === "ask") {
    args.push("--mode", "ask");
  }

  args.push("--trust");

  if (config.force) {
    args.push("--force");
  }

  if (config.approveMcps) {
    args.push("--approve-mcps");
  }

  if (config.sandbox === "enabled" || config.sandbox === "disabled") {
    args.push("--sandbox", config.sandbox);
  }

  args.push(
    "--output-format",
    opts.stream ? "stream-json" : "text",
  );

  if (opts.stream) {
    args.push("--stream-partial-output");
  }

  if (opts.model) {
    args.push("--model", opts.model);
  }

  if (opts.apiKey) {
    args.push("--api-key", opts.apiKey);
  }

  for (const header of config.customHeaders) {
    if (header.includes(":")) {
      args.push("--header", header);
    }
  }

  args.push("--workspace", opts.workspaceDir);

  if (opts.chatId) {
    args.push("--resume", opts.chatId);
  }

  args.push(opts.prompt);

  return { args, mode };
}
