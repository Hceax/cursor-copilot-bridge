import type { BridgeConfig } from "../config.js";
import { run } from "./process.js";
import { log } from "../log.js";

export interface NormalizedMessage {
  role: string;
  content: string;
}

interface Session {
  chatId: string;
  messages: NormalizedMessage[];
  userTexts: string[];
  mode: "agent" | "ask";
  lastActivity: number;
}

export interface SessionResult {
  chatId: string;
  isNew: boolean;
  lastUserMessage: string;
}

const MAX_SESSIONS = 50;
const USER_REQUEST_RE = /<userRequest>\s*([\s\S]*?)\s*<\/userRequest>/;

function extractUserText(content: string): string {
  const m = content.match(USER_REQUEST_RE);
  return m ? m[1].trim() : content;
}

function getUserTexts(messages: NormalizedMessage[]): string[] {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => extractUserText(m.content));
}

function userPrefixLen(a: string[], b: string[]): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) return i;
  }
  return minLen;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private sessionTtlMs: number = 30 * 60_000) {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  async processRequest(
    config: BridgeConfig,
    messages: NormalizedMessage[],
    lastUserMessage: string,
    mode: "agent" | "ask" = "agent",
  ): Promise<SessionResult> {
    const incomingUsers = getUserTexts(messages);
    const match = this.findSession(incomingUsers, mode);

    if (match) {
      const prefixLen = userPrefixLen(incomingUsers, match.userTexts);

      if (prefixLen < match.userTexts.length) {
        this.sessions.delete(match.chatId);
        log(
          `Session ${match.chatId.slice(0, 8)}...: checkpoint (user prefix ${prefixLen}/${match.userTexts.length}), new session`,
        );
      } else {
        const kind =
          incomingUsers.length > match.userTexts.length ? "resume" : "retry";
        match.messages = messages;
        match.userTexts = incomingUsers;
        match.lastActivity = Date.now();
        log(
          `Session ${match.chatId.slice(0, 8)}...: ${kind} [${mode}] (${incomingUsers.length} user msgs, ${this.sessions.size} active)`,
        );
        return {
          chatId: match.chatId,
          isNew: false,
          lastUserMessage,
        };
      }
    }

    if (this.sessions.size >= MAX_SESSIONS) {
      this.evictOldest();
    }

    const chatId = await createCliChat(config);
    this.sessions.set(chatId, {
      chatId,
      messages,
      userTexts: incomingUsers,
      mode,
      lastActivity: Date.now(),
    });
    log(
      `Session ${chatId.slice(0, 8)}...: new [${mode}] (${incomingUsers.length} user msgs, ${this.sessions.size} active)`,
    );
    return { chatId, isNew: true, lastUserMessage };
  }

  getActiveCount(): number {
    return this.sessions.size;
  }

  private findSession(incomingUsers: string[], mode: "agent" | "ask"): Session | null {
    let bestSession: Session | null = null;
    let bestMatchLen = 0;

    for (const session of this.sessions.values()) {
      if (session.mode !== mode) continue;
      const matchLen = userPrefixLen(incomingUsers, session.userTexts);
      if (matchLen > bestMatchLen) {
        bestMatchLen = matchLen;
        bestSession = session;
      }
    }

    return bestMatchLen >= 1 ? bestSession : null;
  }

  private evictOldest() {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [id, session] of this.sessions) {
      if (session.lastActivity < oldestTime) {
        oldestTime = session.lastActivity;
        oldest = id;
      }
    }
    if (oldest) {
      this.sessions.delete(oldest);
      log(`Session evicted (limit ${MAX_SESSIONS})`);
    }
  }

  private cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.sessionTtlMs) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log(`Session cleanup: removed ${cleaned}, ${this.sessions.size} remaining`);
    }
  }

  destroy() {
    clearInterval(this.cleanupTimer);
    this.sessions.clear();
    log("SessionManager destroyed");
  }
}

async function createCliChat(config: BridgeConfig): Promise<string> {
  const result = await run(config.agentPath, ["create-chat"], {
    timeoutMs: 15_000,
  });
  const chatId = result.stdout.trim();
  if (!chatId || result.code !== 0) {
    throw new Error(
      `Failed to create CLI chat (exit ${result.code}): ${result.stderr}`,
    );
  }
  return chatId;
}
