import { accessSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { delimiter } from "node:path";

/**
 * Known absolute path to the locally installed Claude CLI for the current dev
 * machine. Used as the second-tier fallback after `CLAUDE_BIN` so that even
 * environments with a stripped PATH (a common Cursor agent issue) can still
 * locate the CLI.
 *
 * This is intentionally a hard-coded literal rather than a config lookup
 * because v1 targets the locally installed Claude version exclusively.
 */
const KNOWN_LOCAL_CLAUDE_BIN =
  "/Users/abelmohler/.nvm/versions/node/v20.19.0/bin/claude";

/**
 * Result of a successful binary resolution.
 */
export interface ResolvedClaudeBin {
  path: string;
  source: "env" | "known-local" | "path";
}

/**
 * Returned when no usable Claude CLI binary can be located.
 */
export class ClaudeBinNotFoundError extends Error {
  public readonly attempts: string[];

  constructor(attempts: string[]) {
    super(
      `Could not locate the Claude CLI binary. Tried (in order): ${attempts.join(", ")}`,
    );
    this.name = "ClaudeBinNotFoundError";
    this.attempts = attempts;
  }
}

/**
 * Lightweight executable check used by the resolver.
 *
 * `accessSync` with `X_OK` is a non-blocking, sync POSIX permission check that
 * avoids spawning a subprocess just to validate existence.
 */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the `claude` executable on PATH without relying on the shell.
 *
 * We avoid `which` / `command -v` because Cursor's agent shell may not have
 * the user's profile loaded; instead we walk `process.env.PATH` directly so
 * resolution is deterministic and platform-friendly.
 */
function findOnPath(env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? "";
  if (!pathValue) return null;

  const segments = pathValue.split(delimiter).filter(Boolean);
  for (const segment of segments) {
    const candidate = `${segment}/claude`;
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve the Claude CLI binary path using the documented precedence:
 *
 *   1. `CLAUDE_BIN` environment variable (preferred override)
 *   2. Known-local absolute path baked into the build
 *   3. `claude` discovered on `PATH`
 *
 * Throws `ClaudeBinNotFoundError` with the full list of attempts when no
 * candidate is executable. The `attempts` array is preserved for diagnostics
 * surfaced through the MCP tool error response.
 */
export function resolveClaudeBin(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedClaudeBin {
  const attempts: string[] = [];

  const fromEnv = env.CLAUDE_BIN?.trim();
  if (fromEnv) {
    attempts.push(`env:CLAUDE_BIN=${fromEnv}`);
    if (isExecutable(fromEnv)) {
      return { path: fromEnv, source: "env" };
    }
  }

  attempts.push(`known-local:${KNOWN_LOCAL_CLAUDE_BIN}`);
  if (isExecutable(KNOWN_LOCAL_CLAUDE_BIN)) {
    return { path: KNOWN_LOCAL_CLAUDE_BIN, source: "known-local" };
  }

  const fromPath = findOnPath(env);
  attempts.push(`PATH:${fromPath ?? "<not found>"}`);
  if (fromPath) {
    return { path: fromPath, source: "path" };
  }

  throw new ClaudeBinNotFoundError(attempts);
}

/**
 * Probe the resolved binary by invoking `--version`.
 *
 * Used by tests and optional health checks; intentionally not invoked from the
 * hot path so we don't add startup latency or spurious failures when Anthropic
 * changes the version output format.
 */
export function probeClaudeVersion(binPath: string): string {
  return execFileSync(binPath, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  }).trim();
}
