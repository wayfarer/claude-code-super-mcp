# claude-code-super-mcp

> The Claude Code MCP Sucks. But it Doesn't have to.

A local **stdio MCP server** in Node.js that wraps the Claude Code CLI as a
single agent-friendly tool. Unlike the official MCP integration — which
exposes only Claude's file read/write proxy — this server lets agents invoke
the **full agentic Claude Code CLI** (file edits, shell access, tool
orchestration, multi-step reasoning) headlessly.

## Why

Claude Code is most powerful when run as a CLI: it can be driven headlessly
for workflow automations, embedded in pipelines, and given precise
permission scopes. But the existing Claude MCP server proxies only a subset
of its capabilities. This project closes that gap by exposing the CLI itself
as an MCP tool, with verbose schema docs so agents pick the right flags.

## Highlights

- **One tool, full surface**: `run_claude` accepts every meaningful CLI flag
  as a structured field, plus a `rawArgs` escape hatch for forward
  compatibility.
- **Always non-interactive**: `--print` is auto-injected so the subprocess
  never hangs in interactive mode.
- **Light safety defaults**: 60s timeout and 1MB output cap, both per-call
  overridable.
- **Deterministic binary resolution**: `CLAUDE_BIN` → known local path →
  `PATH`. Survives Cursor's PATH-inheritance quirks.
- **Normalized error reporting**: discrete `errorCode` values for
  `binary_not_found`, `spawn_error`, `timeout`, `non_zero_exit`, and
  `invalid_args`.

## Quick start

```bash
npm install
npm run build
```

Then copy `mcp.example.json` into your Cursor MCP config (for example `.cursor/mcp.json` in this workspace), then customize `CLAUDE_BIN`:

```json
{
  "mcpServers": {
    "claude-code-super": {
      "command": "node",
      "args": ["${workspaceFolder}/dist/server.js"],
      "env": {
        "CLAUDE_BIN": "/path/to/your/claude"
      }
    }
  }
}
```

Restart Cursor. The `run_claude` tool will appear in the MCP tool list.

## Tool schema

See [`docs/claude-tool-reference.md`](docs/claude-tool-reference.md) for the
full agent-facing reference, including every input field, output shape,
error codes, and recipes.

Quick example:

```json
{
  "prompt": "Refactor src/index.ts to use async/await",
  "outputFormat": "json",
  "permissionMode": "acceptEdits"
}
```

## Development

```bash
npm run dev        # tsx watch
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run build      # tsc → dist/
```

## Project layout

```
src/
  server.ts                   MCP stdio bootstrap and tool registration
  types.ts                    Tool I/O contracts and defaults
  claude/
    resolveClaudeBin.ts       Binary resolver (CLAUDE_BIN → known → PATH)
    buildArgs.ts              Structured input → CLI argv with --print
    runClaude.ts              spawn + timeout + output cap + error mapping
    argCatalog.ts             Lazy parser for `claude --help` (diagnostics)
docs/
  claude-tool-reference.md    Agent-facing tool reference
mcp.example.json              Portable Cursor MCP config example
```

## Scope

**v1 targets the locally installed Claude Code version.** Behavior across
versions is best-effort. Future scope hooks for version-aware capability
detection, output streaming, and stdin piping are documented in the source.

## License

MIT
