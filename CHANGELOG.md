# Changelog

All notable changes to **Cursor Copilot Bridge** will be documented in this file.

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
