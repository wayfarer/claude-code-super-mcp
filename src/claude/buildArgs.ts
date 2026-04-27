import type { RunClaudeInput } from "../types.js";

/**
 * Raised when caller-supplied input violates known mutually-exclusive
 * relationships between CLI flags. Surfaced as `invalid_args` to MCP clients.
 */
export class InvalidClaudeArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidClaudeArgsError";
  }
}

/**
 * Build the argv array for a Claude CLI invocation from structured input.
 *
 * Design rules:
 *
 * - `--print` is always the first flag. Without it Claude Code enters
 *   interactive mode and the subprocess hangs forever — this is the single
 *   most important contract for v1.
 * - Structured fields are translated into well-formed CLI flags.
 * - `rawArgs` is appended last so callers can override or extend without
 *   losing the structured args; this also keeps forward compatibility with
 *   future Claude flags we have not modeled yet.
 * - The positional `prompt` is always last (Commander treats positional args
 *   as terminal in this CLI's grammar).
 */
export function buildClaudeArgs(input: RunClaudeInput): string[] {
  validateMutualExclusion(input);

  const args: string[] = ["--print"];

  if (input.model) {
    args.push("--model", input.model);
  }
  if (input.fallbackModel) {
    args.push("--fallback-model", input.fallbackModel);
  }
  if (input.outputFormat) {
    args.push("--output-format", input.outputFormat);
  }
  if (input.permissionMode) {
    args.push("--permission-mode", input.permissionMode);
  }
  if (input.allowedTools && input.allowedTools.length > 0) {
    args.push("--allowed-tools", ...input.allowedTools);
  }
  if (input.disallowedTools && input.disallowedTools.length > 0) {
    args.push("--disallowed-tools", ...input.disallowedTools);
  }
  if (input.appendSystemPrompt) {
    args.push("--append-system-prompt", input.appendSystemPrompt);
  }
  if (input.addDirs && input.addDirs.length > 0) {
    args.push("--add-dir", ...input.addDirs);
  }
  if (input.continueSession) {
    args.push("--continue");
  }
  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  }
  if (input.sessionId) {
    args.push("--session-id", input.sessionId);
  }
  if (input.forkSession) {
    args.push("--fork-session");
  }
  if (input.mcpConfig && input.mcpConfig.length > 0) {
    args.push("--mcp-config", ...input.mcpConfig);
  }
  if (input.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  if (input.rawArgs && input.rawArgs.length > 0) {
    args.push(...input.rawArgs);
  }

  if (input.prompt && input.prompt.length > 0) {
    args.push(input.prompt);
  }

  return args;
}

/**
 * Enforce flag combinations that Claude itself either rejects or that produce
 * confusing behavior. Caught here so we can return clean `invalid_args`
 * errors instead of letting users wait for a subprocess failure.
 */
function validateMutualExclusion(input: RunClaudeInput): void {
  if (input.continueSession && input.resumeSessionId) {
    throw new InvalidClaudeArgsError(
      "`continueSession` and `resumeSessionId` are mutually exclusive. " +
        "Use `continueSession: true` to resume the most recent conversation, " +
        "or supply `resumeSessionId` to resume a specific one.",
    );
  }

  if (
    input.forkSession &&
    !input.continueSession &&
    !input.resumeSessionId
  ) {
    throw new InvalidClaudeArgsError(
      "`forkSession` requires either `continueSession: true` or " +
        "`resumeSessionId` to be set.",
    );
  }

  if (
    input.sessionId &&
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      input.sessionId,
    )
  ) {
    throw new InvalidClaudeArgsError(
      "`sessionId` must be a valid UUID per Claude CLI requirements.",
    );
  }
}
