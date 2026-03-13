# Changelog

All notable changes to **Cursor Copilot Bridge** will be documented in this file.

## [0.2.0] - 2026-03-13

### Added
- Thinking block support — streams `LanguageModelThinkingPart` for models that expose reasoning
- Full CLI event parsing: system init, thinking delta/completed, tool call lifecycle

### Changed
- Dropped `chatProvider` proposed API; now uses stable `vscode.lm.registerLanguageModelChatProvider` (reduced dependency on experimental APIs)
- Improved all setting descriptions with clearer English guidance and examples

### Fixed
- Duplicate text output when CLI sends turn-level snapshots after tool calls (added suffix-prefix overlap deduplication)

## [0.1.0] - 2026-03-12

### Added
- Initial release
- Language Model Chat Provider integration with GitHub Copilot Chat
- Cursor CLI (`agent`) spawn with streaming JSON output
- Smart session management: `create-chat` / `--resume` lifecycle
- Automatic mode detection: Agent (read/write) vs Ask (read-only) based on Copilot's tool signals
- Session isolation by mode — switching modes creates new sessions
- Comprehensive error reporting directly in chat (CLI not found, auth failure, timeout, etc.)
- Windows-optimized CLI invocation (bypasses `cmd.exe` argument quirks)
- Configurable settings: API key, model, timeout, session TTL, verbose logging, etc.
- Commands: Configure Cursor CLI, Refresh Available Models
