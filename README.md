# Cursor Copilot Bridge

> Use Cursor's AI models directly in GitHub Copilot Chat — no proxy, no server, just works.

Cursor Copilot Bridge is a VSCode extension that integrates the [Cursor CLI](https://docs.cursor.com/cli) as a Language Model provider for GitHub Copilot Chat. This means you can use all Cursor-supported models (Claude, GPT, Gemini, etc.) right inside the Copilot Chat panel, with full streaming support and multi-turn conversation management.

## Features

- **40+ Models** — All models available in your Cursor subscription appear in the Copilot model picker, including Claude Opus/Sonnet, GPT-4o, Gemini Pro, and more.
- **Zero Configuration** — Install the Cursor CLI, set your API key, and you're ready to go. No proxy server, no port forwarding, no extra processes.
- **Smart Session Management** — Conversations are persisted across messages using Cursor CLI's native `create-chat` / `--resume` mechanism. Switching models or modes within the same chat window is handled seamlessly.
- **Mode-Aware** — Automatically detects whether Copilot is in Agent mode (read/write) or Ask mode (read-only) and passes the correct `--mode` flag to the CLI.
- **Streaming Responses** — Model output is streamed in real-time, token by token, just like native Copilot.
- **Rich Error Reporting** — All errors (auth failure, timeout, rate limit, network issues, etc.) are reported directly in the chat conversation with actionable fix suggestions.
- **Windows-Optimized** — Bypasses `cmd.exe` argument parsing issues by directly invoking `node.exe` from `.cmd` wrappers.

## Prerequisites

1. **GitHub Copilot Chat** — You need an active [GitHub Copilot](https://github.com/features/copilot) subscription (Individual plan required for Language Model Chat Provider API).
2. **Cursor CLI** — Install the Cursor CLI (`agent` binary):

   ```powershell
   # Windows
   irm 'https://cursor.com/install?win32=true' | iex

   # macOS / Linux
   curl -fsSL https://cursor.com/install | bash
   ```

3. **Cursor API Key** — Get your API key from [Cursor Settings](https://cursor.com/settings).

## Installation

### From VSIX (recommended for now)

```bash
# Build from source
git clone https://github.com/hceax/cursor-copilot-bridge.git
cd cursor-copilot-bridge
npm install
npm run build

# Install
code --install-extension cursor-copilot-bridge.vsix
```

### Enable Proposed API

Since this extension uses VSCode's proposed `chatProvider` API, you need to enable it:

1. Open (or create) `~/.vscode/argv.json`
2. Add:

   ```json
   {
     "enable-proposed-api": ["nicepkg.cursor-copilot-bridge"]
   }
   ```

3. Restart VSCode.

## Configuration

Open **Settings** (`Ctrl+,`) and search for `cursorBridge`:

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorBridge.apiKey` | `""` | Your Cursor API key. Leave empty to use `agent login` auth. |
| `cursorBridge.agentPath` | `"agent"` | Path to the Cursor CLI binary. Default assumes it's in PATH. |
| `cursorBridge.defaultModel` | `""` | Pin a default model. Leave empty to show all available models. |
| `cursorBridge.force` | `true` | Auto-approve tool invocations (`--force`). |
| `cursorBridge.approveMcps` | `false` | Auto-approve MCP servers (`--approve-mcps`). |
| `cursorBridge.sandbox` | `""` | Override sandbox mode: `""` (default), `"enabled"`, `"disabled"`. |
| `cursorBridge.sessionTtlMinutes` | `30` | Idle session timeout in minutes. |
| `cursorBridge.maxHistoryTurns` | `10` | Max conversation turns sent when creating a new CLI session. |
| `cursorBridge.timeoutSeconds` | `300` | Max seconds to wait for a CLI response. |
| `cursorBridge.verbose` | `false` | Enable verbose logging in the Output panel. |

## Usage

1. Open the **Copilot Chat** panel (`Ctrl+Shift+I`)
2. Click the model picker dropdown — you'll see all Cursor models listed
3. Select a model and start chatting

The extension automatically:
- Creates a CLI session for each conversation
- Resumes existing sessions when you continue a chat
- Creates separate sessions when you switch between Agent/Ask modes
- Streams responses in real-time

### Commands

- **Cursor Bridge: Configure Cursor CLI** — Quick-access menu for settings, status, model refresh, and logs.
- **Cursor Bridge: Refresh Available Models** — Re-fetch the model list from the CLI.

## How It Works

```
┌──────────────┐     messages      ┌────────────────────┐
│  Copilot Chat │ ───────────────► │  Cursor Copilot    │
│  (VSCode UI)  │                  │  Bridge Extension  │
│              │ ◄─────────────── │                    │
└──────────────┘  streamed text    └────────┬───────────┘
                                            │ spawn
                                            ▼
                                   ┌────────────────────┐
                                   │  Cursor CLI (agent) │
                                   │  --print --resume   │
                                   │  --output-format    │
                                   │    stream-json      │
                                   └────────┬───────────┘
                                            │ API call
                                            ▼
                                   ┌────────────────────┐
                                   │  Cursor Cloud API   │
                                   │  (Claude, GPT, etc.)│
                                   └────────────────────┘
```

1. Copilot Chat calls our `LanguageModelChatProvider` with the user's messages
2. The extension extracts the user's actual question, manages session state, and builds CLI arguments
3. The Cursor CLI is spawned as a child process with `--print --output-format stream-json`
4. Streaming JSON deltas from the CLI are parsed and forwarded to Copilot Chat in real-time
5. Session IDs are tracked so subsequent messages in the same conversation reuse the same CLI session (`--resume`)

## Troubleshooting

### "Cursor CLI Not Found"
- Make sure `agent` is in your PATH, or set the full path in `cursorBridge.agentPath`
- On Windows, if you installed to a custom location, point to the `agent.cmd` file

### "Authentication Failed"
- Set `cursorBridge.apiKey` in Settings with your Cursor API key
- Or run `agent login` in a terminal to authenticate interactively

### Models not showing up
- Run **Cursor Bridge: Refresh Available Models** from the Command Palette
- Check the Output panel (Cursor Bridge) for errors

### Slow responses
- Response times depend on the model. Gemini Pro may take 30-40s, Claude Opus 7-10s.
- Increase `cursorBridge.timeoutSeconds` if requests are timing out.

### Verbose logging
- Set `cursorBridge.verbose` to `true` in Settings
- Open **Output** panel → select **Cursor Bridge** from the dropdown
- All CLI arguments, streaming data, and session events are logged

## Known Limitations

- **Proposed API** — This extension uses VSCode's proposed `chatProvider` API, which requires explicit opt-in via `argv.json`. This API may change in future VSCode versions.
- **CLI Mode Enforcement** — The Cursor CLI's `--mode ask` flag does not strictly prevent file writes in all cases. Mode detection and signaling work correctly on the extension side.
- **No Conversation ID from Copilot** — VSCode's Language Model Chat Provider API does not expose a conversation/session ID. Session matching is based on the sequence of user messages.

## License

[MIT](LICENSE)
