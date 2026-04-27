#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runClaude } from "./claude/runClaude.js";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  type RunClaudeInput,
} from "./types.js";

const SERVER_NAME = "claude-code-super-mcp";
const SERVER_VERSION = "0.1.0";

/**
 * The single MCP tool exposed by this server. Description text is intentionally
 * verbose because MCP clients show it directly to LLM agents — concise text
 * here means worse tool selection in practice.
 */
const RUN_CLAUDE_DESCRIPTION = [
  "Run the locally installed Claude Code CLI as a one-shot, non-interactive subprocess.",
  "",
  "This tool always invokes `claude --print ...` so the CLI runs headlessly and exits.",
  "Output is buffered and returned in full (subject to `maxOutputBytes`); streaming is",
  "not supported in this version. Use this when an agent should leverage Claude Code's",
  "full agentic capabilities (file edits, shell access, multi-tool orchestration) rather",
  "than only its read/write file proxy.",
  "",
  "Common patterns:",
  "  - Single-shot prompt:           { prompt: 'Refactor X' }",
  "  - JSON-structured output:       { prompt: '...', outputFormat: 'json' }",
  "  - Continue last conversation:   { prompt: 'Now do Y', continueSession: true }",
  "  - Sandboxed run (no prompts):   { prompt: '...', dangerouslySkipPermissions: true }",
  "",
  "Use `rawArgs` for any flag that is not yet modeled as a structured field.",
].join("\n");

const inputShape = {
  prompt: z
    .string()
    .optional()
    .describe(
      "The prompt or instruction to send to Claude. Becomes the positional argument " +
        "to the CLI. Optional only when `continueSession` or `resumeSessionId` is set " +
        "and you want to inspect the existing session without sending new input.",
    ),

  model: z
    .string()
    .optional()
    .describe(
      "Model alias (e.g. `sonnet`, `opus`) or full model name " +
        "(e.g. `claude-sonnet-4-5-20250929`). Maps to `--model`. Leave unset to use the " +
        "configured default.",
    ),

  fallbackModel: z
    .string()
    .optional()
    .describe(
      "Model to fall back to when the primary model is overloaded. Maps to " +
        "`--fallback-model`. Only effective in print mode (which this tool always uses).",
    ),

  outputFormat: z
    .enum(["text", "json", "stream-json"])
    .optional()
    .describe(
      "Output format for Claude's response. Maps to `--output-format`. " +
        "`text` (default) returns plain text. `json` returns a single JSON result " +
        "object — preferred for programmatic post-processing. `stream-json` emits " +
        "newline-delimited JSON events; this tool buffers it but does not stream.",
    ),

  permissionMode: z
    .enum(["default", "acceptEdits", "bypassPermissions", "plan"])
    .optional()
    .describe(
      "Permission posture for the session. Maps to `--permission-mode`. " +
        "`default` prompts on risky actions, `acceptEdits` auto-approves edits, " +
        "`bypassPermissions` accepts everything (use only in trusted environments), " +
        "`plan` runs Claude in planning mode without making changes.",
    ),

  allowedTools: z
    .array(z.string())
    .optional()
    .describe(
      "Tool name patterns Claude is allowed to use. Maps to `--allowed-tools`. " +
        "Examples: `Edit`, `Bash(git:*)`. Combine with `disallowedTools` to fence in " +
        "agent capabilities.",
    ),

  disallowedTools: z
    .array(z.string())
    .optional()
    .describe(
      "Tool name patterns Claude is forbidden from using. Maps to `--disallowed-tools`. " +
        "Takes precedence over `allowedTools` for overlapping patterns.",
    ),

  appendSystemPrompt: z
    .string()
    .optional()
    .describe(
      "Text appended to Claude's default system prompt. Maps to `--append-system-prompt`. " +
        "Use to add per-call constraints without replacing Claude's defaults.",
    ),

  addDirs: z
    .array(z.string())
    .optional()
    .describe(
      "Additional directories to grant Claude tool access to. Maps to `--add-dir`. " +
        "By default Claude is restricted to its `cwd` — use this to whitelist sibling " +
        "or parent directories.",
    ),

  continueSession: z
    .boolean()
    .optional()
    .describe(
      "Resume the most recent conversation. Maps to `--continue`. Mutually exclusive " +
        "with `resumeSessionId`.",
    ),

  resumeSessionId: z
    .string()
    .optional()
    .describe(
      "Resume a specific conversation by session ID. Maps to `--resume`. Mutually " +
        "exclusive with `continueSession`.",
    ),

  sessionId: z
    .string()
    .optional()
    .describe(
      "Use a specific UUID for the session. Maps to `--session-id`. Must be a valid " +
        "v4 UUID per the CLI's requirements.",
    ),

  forkSession: z
    .boolean()
    .optional()
    .describe(
      "When resuming, branch into a new session ID instead of reusing the original. " +
        "Maps to `--fork-session`. Requires `continueSession` or `resumeSessionId`.",
    ),

  mcpConfig: z
    .array(z.string())
    .optional()
    .describe(
      "Paths to MCP config JSON files (or inline JSON strings) to load servers from " +
        "for this run. Maps to `--mcp-config`. Useful for layering additional MCP " +
        "servers on top of Claude's defaults.",
    ),

  dangerouslySkipPermissions: z
    .boolean()
    .optional()
    .describe(
      "Bypass all Claude Code permission checks. Maps to `--dangerously-skip-permissions`. " +
        "WARNING: Only use in sandboxes or trusted environments — Claude will run any " +
        "tool action without confirmation.",
    ),

  cwd: z
    .string()
    .optional()
    .describe(
      "Working directory for the Claude subprocess. Defaults to the MCP server's " +
        "current working directory. Set this to scope a run to a specific project.",
    ),

  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `Maximum wall-clock time in ms before the subprocess is killed. Default: ${DEFAULT_TIMEOUT_MS}ms.`,
    ),

  maxOutputBytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `Maximum combined stdout+stderr bytes to retain. Excess bytes are dropped and ` +
        `\`truncated: true\` is returned. Default: ${DEFAULT_MAX_OUTPUT_BYTES} bytes.`,
    ),

  rawArgs: z
    .array(z.string())
    .optional()
    .describe(
      "Pass-through array of raw CLI arguments. Appended after structured args and " +
        "before the positional `prompt`. Use this for any Claude flag this tool does " +
        "not yet model — it is the forward-compatibility escape hatch.",
    ),
};

const outputShape = {
  success: z.boolean(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int(),
  invokedCommand: z.string(),
  truncated: z.boolean(),
  errorCode: z
    .enum([
      "binary_not_found",
      "spawn_error",
      "timeout",
      "non_zero_exit",
      "invalid_args",
    ])
    .optional(),
  errorMessage: z.string().optional(),
};

/**
 * Construct and return a configured `McpServer`. Exposed as a factory so tests
 * can instantiate without starting the stdio transport.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "run_claude",
    {
      title: "Run Claude Code CLI",
      description: RUN_CLAUDE_DESCRIPTION,
      inputSchema: inputShape,
      outputSchema: outputShape,
      annotations: {
        title: "Run Claude Code CLI",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const result = await runClaude(input as RunClaudeInput);
      const structuredContent: { [k: string]: unknown } = {
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        invokedCommand: result.invokedCommand,
        truncated: result.truncated,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      };
      return {
        structuredContent,
        content: [
          {
            type: "text" as const,
            text: result.success
              ? result.stdout || "(no stdout)"
              : `[${result.errorCode ?? "error"}] ${result.errorMessage ?? "Claude CLI failed."}\n\n${result.stderr || result.stdout}`,
          },
        ],
        isError: !result.success,
      };
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const entry = process.argv[1] ?? "";
const isDirectInvocation =
  entry.endsWith("/server.js") || entry.endsWith("/server.ts");

if (isDirectInvocation) {
  main().catch((err) => {
    console.error("Fatal MCP server error:", err);
    process.exit(1);
  });
}
