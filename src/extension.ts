import * as vscode from "vscode";
import { loadConfig } from "./config.js";
import { CursorBridgeProvider } from "./provider.js";
import { log, getOutputChannel } from "./log.js";

let provider: CursorBridgeProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  log("Cursor Copilot Bridge activating...");

  provider = new CursorBridgeProvider(() => loadConfig());

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider("cursor-bridge", provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorBridge.configure", async () => {
      const config = loadConfig();

      const choice = await vscode.window.showQuickPick(
        [
          {
            label: "$(gear) Open Settings",
            description: "Edit all Cursor Bridge settings",
            action: "settings",
          },
          {
            label: "$(refresh) Refresh Models",
            description: "Re-fetch available models from Cursor CLI",
            action: "refresh",
          },
          {
            label: "$(info) Status",
            description: `Agent: ${config.agentPath} | Sessions: ${provider?.getSessionCount() ?? 0}`,
            action: "status",
          },
          {
            label: "$(output) Show Logs",
            description: "Open the output channel",
            action: "logs",
          },
        ],
        { title: "Cursor Copilot Bridge" },
      );

      if (!choice) return;

      switch (choice.action) {
        case "settings":
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "cursorBridge",
          );
          break;

        case "refresh":
          try {
            const models = await provider!.refreshModels();
            vscode.window.showInformationMessage(
              `Cursor Bridge: Found ${models.length} models.`,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Cursor Bridge: ${msg}`);
          }
          break;

        case "status": {
          const channel = getOutputChannel();
          channel.appendLine("--- Status ---");
          channel.appendLine(`Agent path: ${config.agentPath}`);
          channel.appendLine(`Force: ${config.force}`);
          channel.appendLine(`Default model: ${config.defaultModel || "(auto)"}`);
          channel.appendLine(`Session TTL: ${config.sessionTtlMs / 60_000} min`);
          channel.appendLine(`Active sessions: ${provider?.getSessionCount() ?? 0}`);
          channel.appendLine(`Verbose: ${config.verbose}`);
          channel.show();
          break;
        }

        case "logs":
          getOutputChannel().show();
          break;
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorBridge.refreshModels", async () => {
      try {
        const models = await provider!.refreshModels();
        vscode.window.showInformationMessage(
          `Cursor Bridge: Found ${models.length} models.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Cursor Bridge: ${msg}`);
      }
    }),
  );

  log("Cursor Copilot Bridge activated.");
}

export function deactivate() {
  provider?.destroy();
  provider = undefined;
  log("Cursor Copilot Bridge deactivated.");
}
