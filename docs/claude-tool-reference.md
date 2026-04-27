# `run_claude` Tool Reference

A comprehensive, agent-facing reference for the single MCP tool exposed by
`claude-code-super-mcp`. The tool wraps the locally installed Claude Code
CLI as a non-interactive subprocess and surfaces its full flag surface
through structured input plus a `rawArgs` escape hatch.

> The MCP tool description (visible in the LLM's tool list) is intentionally
> brief. This document is the deeper reference — link or paste it into agent
> system prompts when richer guidance is needed.

---

## When to use this tool

Reach for `run_claude` when an agent needs the **full agentic capabilities** of
Claude Code — file edits, shell access, tool orchestration, multi-step
reasoning — not just a chat completion. Examples:

- Implement a multi-file change against a spec.
- Run an autonomous "reality check" pass on an existing project.
- Generate a design mockup or scaffold a new feature.
- Resume an in-progress conversation and push it forward.

If you only need single-turn LLM completions without filesystem or tool
access, prefer the regular Claude API or a chat tool — `run_claude` spins up
a full Claude Code session each call.

---

## Execution model

- The tool always invokes:
  ```
  claude --print [structured-flags...] [rawArgs...] [prompt]
  ```
- `--print` is **always injected**. Without it the CLI enters interactive
  mode and the subprocess hangs forever.
- Output is **buffered**. Streaming is not supported in this version; for
  long runs, increase `timeoutMs` and `maxOutputBytes`.
- The subprocess **inherits `process.env`**. Set `CLAUDE_BIN` to override
  binary resolution.

---

## Input fields

### Required-ish

| Field | Type | Notes |
|------|------|-------|
| `prompt` | `string` | The instruction or question for Claude. Optional only when resuming/continuing a session and no new input is needed. |

### Model and output shaping

| Field | Type | CLI flag | Notes |
|------|------|----------|-------|
| `model` | `string` | `--model` | Alias (`sonnet`, `opus`) or full model name. |
| `fallbackModel` | `string` | `--fallback-model` | Used only when primary is overloaded; `--print` mode required (we always satisfy this). |
| `outputFormat` | `"text" \| "json" \| "stream-json"` | `--output-format` | Use `json` for programmatic parsing of the result envelope. |

### Permissions and tool gating

| Field | Type | CLI flag | Notes |
|------|------|----------|-------|
| `permissionMode` | `"default" \| "acceptEdits" \| "bypassPermissions" \| "plan"` | `--permission-mode` | `plan` runs Claude in non-mutating planning mode. |
| `allowedTools` | `string[]` | `--allowed-tools` | Tool patterns Claude may use (e.g. `Edit`, `Bash(git:*)`). |
| `disallowedTools` | `string[]` | `--disallowed-tools` | Takes precedence over `allowedTools` for overlapping patterns. |
| `dangerouslySkipPermissions` | `boolean` | `--dangerously-skip-permissions` | **Use only in sandboxes.** Auto-approves every tool action. |

### Context and prompt augmentation

| Field | Type | CLI flag | Notes |
|------|------|----------|-------|
| `appendSystemPrompt` | `string` | `--append-system-prompt` | Appended to Claude's default system prompt; does not replace it. |
| `addDirs` | `string[]` | `--add-dir` | Whitelist additional directories Claude can read/write. |
| `mcpConfig` | `string[]` | `--mcp-config` | JSON files (or inline JSON strings) of MCP servers to layer in. |

### Sessions

| Field | Type | CLI flag | Notes |
|------|------|----------|-------|
| `continueSession` | `boolean` | `--continue` | Resume the most recent session. **Mutually exclusive with `resumeSessionId`.** |
| `resumeSessionId` | `string` | `--resume` | Resume a specific session by ID. |
| `sessionId` | `string (UUID)` | `--session-id` | Pin a deterministic session UUID. |
| `forkSession` | `boolean` | `--fork-session` | Branch into a new session ID when resuming. Requires `continueSession` or `resumeSessionId`. |

### Subprocess controls

| Field | Type | Default | Notes |
|------|------|---------|-------|
| `cwd` | `string` | MCP server cwd | Working directory for the subprocess; scope a run to a project. |
| `timeoutMs` | `number` | `60000` | Hard kill after this many ms. SIGTERM, then SIGKILL after a 2s grace. |
| `maxOutputBytes` | `number` | `1048576` | Combined stdout+stderr cap; excess bytes are dropped and `truncated: true` is reported. |

### Escape hatch

| Field | Type | Notes |
|------|------|-------|
| `rawArgs` | `string[]` | Appended after structured flags and before the prompt. Use for any Claude flag not yet modeled. |

---

## Output shape

```ts
{
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  invokedCommand: string;       // Pretty-printed argv for diagnostics
  truncated: boolean;           // true if maxOutputBytes was exceeded
  errorCode?:
    | "binary_not_found"
    | "spawn_error"
    | "timeout"
    | "non_zero_exit"
    | "invalid_args";
  errorMessage?: string;
}
```

### Error codes

- **`binary_not_found`** — could not resolve a `claude` executable. Set `CLAUDE_BIN`.
- **`spawn_error`** — Node failed to start the process (permissions, etc.).
- **`timeout`** — exceeded `timeoutMs`. Increase or split into smaller runs.
- **`non_zero_exit`** — CLI ran but returned a non-zero exit code. Inspect `stderr`.
- **`invalid_args`** — caught locally before spawn; combine with `errorMessage` for guidance.

---

## Recipes

### Single-shot agent task

```json
{
  "prompt": "Refactor src/index.ts to use async/await",
  "outputFormat": "json",
  "permissionMode": "acceptEdits"
}
```

### Planning pass (no mutations)

```json
{
  "prompt": "Plan a migration from Jest to Vitest in this repo",
  "permissionMode": "plan",
  "outputFormat": "json"
}
```

### Continue a previous conversation

```json
{
  "prompt": "Now run the test suite and fix any failures",
  "continueSession": true,
  "permissionMode": "acceptEdits"
}
```

### Sandbox run with bypassed permissions

```json
{
  "prompt": "Generate a complete TODO app in ./tmp/todo",
  "cwd": "/Users/me/sandbox",
  "dangerouslySkipPermissions": true,
  "timeoutMs": 600000
}
```

### Use a flag we have not modeled yet

```json
{
  "prompt": "What changed?",
  "rawArgs": ["--debug", "api,hooks"]
}
```

---

## Operational notes

- **Binary resolution order**: `CLAUDE_BIN` → known local absolute path
  → `claude` on `PATH`. Set `CLAUDE_BIN` in the MCP server `env` block to
  guarantee deterministic resolution across Cursor restarts.
- **Cursor PATH inheritance is unreliable.** If the MCP server logs
  `binary_not_found`, set `CLAUDE_BIN` explicitly in `mcp.json`.
- **Long runs**: bump both `timeoutMs` and `maxOutputBytes` together;
  a long run that hits the byte cap will return `success: true, truncated: true`.
