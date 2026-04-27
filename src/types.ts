/**
 * Shared type definitions for the Claude CLI MCP proxy.
 *
 * These types describe the contract between the MCP tool layer and the
 * subprocess runner. They are intentionally framework-free so they can be
 * imported from tests, the runner, and the server bootstrap.
 */

/**
 * Categorized error codes that map cleanly to user-actionable failures.
 *
 * - `binary_not_found` — the Claude CLI executable could not be located
 * - `spawn_error`     — Node failed to spawn the subprocess (permissions, ENOENT after resolution, etc.)
 * - `timeout`         — the subprocess exceeded the configured timeout and was killed
 * - `non_zero_exit`   — the CLI ran but returned a non-zero exit code
 * - `invalid_args`    — input arguments failed local validation before spawn
 */
export type ClaudeRunErrorCode =
  | "binary_not_found"
  | "spawn_error"
  | "timeout"
  | "non_zero_exit"
  | "invalid_args";

/**
 * Structured input accepted by the `run_claude` tool.
 *
 * Each field maps to a CLI flag or controls subprocess execution. Unmodeled
 * or future flags can be passed through `rawArgs` without code changes.
 */
export interface RunClaudeInput {
  prompt?: string;
  model?: string;
  fallbackModel?: string;
  outputFormat?: "text" | "json" | "stream-json";
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  allowedTools?: string[];
  disallowedTools?: string[];
  appendSystemPrompt?: string;
  addDirs?: string[];
  continueSession?: boolean;
  resumeSessionId?: string;
  sessionId?: string;
  forkSession?: boolean;
  mcpConfig?: string[];
  dangerouslySkipPermissions?: boolean;
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  rawArgs?: string[];
}

/**
 * Successful or failed result of a single Claude CLI invocation.
 *
 * The shape is intentionally flat so it serializes cleanly through MCP
 * structuredContent.
 */
export interface RunClaudeResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  invokedCommand: string;
  truncated: boolean;
  errorCode?: ClaudeRunErrorCode;
  errorMessage?: string;
}

/**
 * Default execution constraints applied when a caller does not supply them.
 *
 * Both can be overridden per-call via `RunClaudeInput`.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MB
