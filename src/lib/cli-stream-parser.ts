/**
 * Stateful stream parser for Cursor CLI `--output-format stream-json
 * --stream-partial-output` output.
 *
 * With `--stream-partial-output`, assistant messages with `timestamp_ms`
 * are true deltas. The final assistant message (no `timestamp_ms`)
 * contains the full accumulated text and is skipped to avoid duplicates.
 *
 * Event types handled:
 *  - system.init        → session metadata
 *  - thinking.delta     → thinking text delta
 *  - thinking.completed → thinking finished
 *  - assistant          → text delta or final accumulated text
 *  - tool_call.started  → tool invocation started
 *  - tool_call.completed→ tool invocation result
 *  - result.success     → completion with usage stats
 */

export interface ToolCallInfo {
  callId: string;
  toolType: string;
  description: string;
}

export interface ToolCallResult extends ToolCallInfo {
  success: boolean;
  executionTimeMs?: number;
}

export interface UsageStats {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
  durationApiMs?: number;
}

export interface SessionInitInfo {
  sessionId: string;
  model: string;
  cwd: string;
  permissionMode: string;
}

export interface StreamParserCallbacks {
  onText: (text: string) => void;
  onDone: () => void;
  onThinkingDelta?: (text: string) => void;
  onThinkingDone?: () => void;
  onToolCallStarted?: (info: ToolCallInfo) => void;
  onToolCallCompleted?: (result: ToolCallResult) => void;
  onUsage?: (stats: UsageStats) => void;
  onSessionInit?: (info: SessionInitInfo) => void;
}

export function createStreamParser(cb: StreamParserCallbacks): (line: string) => void {
  let accumulated = "";
  let done = false;

  return (line: string) => {
    if (done) return;
    try {
      const obj = JSON.parse(line);

      switch (obj.type) {
        case "system": {
          if (obj.subtype === "init" && cb.onSessionInit) {
            cb.onSessionInit({
              sessionId: obj.session_id ?? "",
              model: obj.model ?? "",
              cwd: obj.cwd ?? "",
              permissionMode: obj.permissionMode ?? "",
            });
          }
          break;
        }

        case "thinking": {
          if (obj.subtype === "delta" && obj.text && cb.onThinkingDelta) {
            cb.onThinkingDelta(obj.text);
          } else if (obj.subtype === "completed" && cb.onThinkingDone) {
            cb.onThinkingDone();
          }
          break;
        }

        case "assistant": {
          const text = extractAssistantText(obj);
          if (!text) break;

          if (obj.timestamp_ms) {
            cb.onText(text);
          } else {
            if (text === accumulated) break;
            if (text.startsWith(accumulated) && accumulated.length > 0) {
              const delta = text.slice(accumulated.length);
              if (delta) cb.onText(delta);
            } else {
              cb.onText(text);
            }
          }
          accumulated += (obj.timestamp_ms ? text : "");
          if (!obj.timestamp_ms) accumulated = text;
          break;
        }

        case "tool_call": {
          const info = extractToolCallInfo(obj);
          if (obj.subtype === "started" && cb.onToolCallStarted && info) {
            cb.onToolCallStarted(info);
          } else if (obj.subtype === "completed" && cb.onToolCallCompleted && info) {
            const result = extractToolCallResult(obj, info);
            cb.onToolCallCompleted(result);
          }
          break;
        }

        case "result": {
          if (obj.subtype === "success") {
            if (cb.onUsage && obj.usage) {
              cb.onUsage({
                inputTokens: obj.usage.inputTokens,
                outputTokens: obj.usage.outputTokens,
                cacheReadTokens: obj.usage.cacheReadTokens,
                cacheWriteTokens: obj.usage.cacheWriteTokens,
                durationMs: obj.duration_ms,
                durationApiMs: obj.duration_api_ms,
              });
            }
            done = true;
            cb.onDone();
          }
          break;
        }
      }
    } catch {
      /* non-JSON lines are ignored */
    }
  };
}

function extractAssistantText(obj: any): string {
  if (!obj.message?.content) return "";
  return obj.message.content
    .filter((p: any) => p.type === "text" && p.text)
    .map((p: any) => p.text)
    .join("");
}

function extractToolCallInfo(obj: any): ToolCallInfo | null {
  const callId = obj.call_id ?? "";
  const tc = obj.tool_call;
  if (!tc) return null;

  const toolType = Object.keys(tc).find((k) => k.endsWith("ToolCall")) ?? "unknown";
  const inner = tc[toolType];
  const description = inner?.description ?? tc.description ?? "";

  return { callId, toolType: toolType.replace("ToolCall", ""), description };
}

function extractToolCallResult(obj: any, info: ToolCallInfo): ToolCallResult {
  const tc = obj.tool_call;
  const toolKey = Object.keys(tc).find((k) => k.endsWith("ToolCall")) ?? "";
  const inner = tc[toolKey];
  const result = inner?.result;

  let success = false;
  let executionTimeMs: number | undefined;

  if (result?.success) {
    success = true;
    executionTimeMs = result.success.executionTime ?? result.success.localExecutionTimeMs;
  }

  return { ...info, success, executionTimeMs };
}
