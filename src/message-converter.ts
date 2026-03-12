import * as vscode from "vscode";
import type { NormalizedMessage } from "./lib/session-manager.js";

const USER_REQUEST_RE = /<userRequest>\s*([\s\S]*?)\s*<\/userRequest>/;

/**
 * Extract the actual user request from a Copilot-wrapped message.
 * Copilot wraps user input inside `<userRequest>` tags with surrounding
 * context/editor boilerplate. We strip all of that and return just the
 * user's actual question.
 */
export function extractUserRequest(text: string): string {
  const match = text.match(USER_REQUEST_RE);
  return match ? match[1].trim() : text;
}

/**
 * Convert VSCode LanguageModelChatRequestMessage array into our simplified
 * NormalizedMessage array, filtering out system boilerplate.
 */
export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): NormalizedMessage[] {
  const result: NormalizedMessage[] = [];

  for (const msg of messages) {
    const role = roleToString(msg.role);
    if (!role) continue;

    const text = extractTextFromParts(msg.content);
    if (!text) continue;

    result.push({ role, content: text });
  }

  return result;
}

/**
 * Extract the last user message from the converted messages,
 * stripping Copilot wrapper tags.
 */
export function findLastUserMessage(
  messages: NormalizedMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return extractUserRequest(messages[i].content);
    }
  }
  return null;
}

/**
 * Build a condensed prompt for the first message of a new CLI session.
 * Strips Copilot system/developer messages and limits history.
 */
export function buildNewSessionPrompt(
  messages: NormalizedMessage[],
  maxTurns: number,
): string {
  const convo: string[] = [];

  for (const m of messages) {
    const text = m.role === "user" ? extractUserRequest(m.content) : m.content;

    if (m.role === "user") convo.push(`User: ${text}`);
    else if (m.role === "assistant") convo.push(`Assistant: ${text}`);
  }

  const limited = convo.slice(-(maxTurns * 2));
  return limited.join("\n\n");
}

function roleToString(
  role: vscode.LanguageModelChatMessageRole,
): string | null {
  switch (role) {
    case vscode.LanguageModelChatMessageRole.User:
      return "user";
    case vscode.LanguageModelChatMessageRole.Assistant:
      return "assistant";
    default:
      return null;
  }
}

function extractTextFromParts(
  content: ReadonlyArray<vscode.LanguageModelTextPart | unknown>,
): string {
  const parts: string[] = [];

  for (const part of content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      parts.push(part.value);
    }
  }

  return parts.join("");
}
