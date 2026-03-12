import * as vscode from "vscode";

let _channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel("Cursor Bridge");
  }
  return _channel;
}

export function log(message: string): void {
  getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
}

export function logVerbose(verbose: boolean, message: string): void {
  if (verbose) log(message);
}
