import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  type RunClaudeInput,
  type RunClaudeResult,
} from "../types.js";
import { buildClaudeArgs, InvalidClaudeArgsError } from "./buildArgs.js";
import {
  ClaudeBinNotFoundError,
  resolveClaudeBin,
} from "./resolveClaudeBin.js";

/**
 * Quote a single argv entry for human-readable display in the
 * `invokedCommand` field. Not used to actually shell-execute anything; we
 * always go through `spawn` with an explicit argv array.
 */
function quoteForDisplay(arg: string): string {
  if (arg === "") return "''";
  if (/^[A-Za-z0-9_\-./:=@+,]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Append a buffer of bytes, enforcing a hard cap. Returns the new buffer and
 * a flag indicating whether truncation occurred this call.
 *
 * We cap on a per-stream basis but track a shared "any truncated" flag in the
 * caller to keep the user-facing semantics simple.
 */
function appendCapped(
  current: Buffer,
  next: Buffer,
  cap: number,
): { buffer: Buffer; truncated: boolean } {
  if (current.length >= cap) {
    return { buffer: current, truncated: true };
  }
  const remaining = cap - current.length;
  if (next.length <= remaining) {
    return { buffer: Buffer.concat([current, next]), truncated: false };
  }
  return {
    buffer: Buffer.concat([current, next.subarray(0, remaining)]),
    truncated: true,
  };
}

/**
 * Execute the Claude CLI as a subprocess and return a normalized result.
 *
 * Behavior:
 *
 * - Always injects `--print` (via `buildClaudeArgs`).
 * - Buffers stdout and stderr up to `maxOutputBytes` (combined cap split per
 *   stream), then drops further bytes and marks `truncated: true`.
 * - Kills the process tree with SIGTERM (then SIGKILL after a grace period)
 *   when `timeoutMs` is exceeded.
 * - Maps known failure modes to discrete `errorCode` values.
 *
 * The function never throws for expected failure modes — failures come back
 * as a `RunClaudeResult` with `success: false` and a populated `errorCode`.
 * This keeps the MCP tool layer trivial.
 */
export async function runClaude(
  input: RunClaudeInput,
): Promise<RunClaudeResult> {
  const start = performance.now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  let resolved;
  try {
    resolved = resolveClaudeBin();
  } catch (err) {
    if (err instanceof ClaudeBinNotFoundError) {
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: Math.round(performance.now() - start),
        invokedCommand: "<unresolved>",
        truncated: false,
        errorCode: "binary_not_found",
        errorMessage: err.message,
      };
    }
    throw err;
  }

  let args: string[];
  try {
    args = buildClaudeArgs(input);
  } catch (err) {
    if (err instanceof InvalidClaudeArgsError) {
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: Math.round(performance.now() - start),
        invokedCommand: resolved.path,
        truncated: false,
        errorCode: "invalid_args",
        errorMessage: err.message,
      };
    }
    throw err;
  }

  const invokedCommand = [resolved.path, ...args]
    .map(quoteForDisplay)
    .join(" ");

  return new Promise<RunClaudeResult>((resolvePromise) => {
    const child = spawn(resolved.path, args, {
      cwd: input.cwd ?? process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuf: Buffer = Buffer.alloc(0);
    let stderrBuf: Buffer = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const perStreamCap = Math.floor(maxOutputBytes / 2);

    const finalize = (result: RunClaudeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(forceKillTimer);
      resolvePromise(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const { buffer, truncated: t } = appendCapped(
        stdoutBuf,
        chunk,
        perStreamCap,
      );
      stdoutBuf = buffer;
      if (t) truncated = true;
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const { buffer, truncated: t } = appendCapped(
        stderrBuf,
        chunk,
        perStreamCap,
      );
      stderrBuf = buffer;
      if (t) truncated = true;
    });

    let forceKillTimer: ReturnType<typeof setTimeout>;
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2_000);
    }, timeoutMs);

    child.on("error", (err) => {
      finalize({
        success: false,
        exitCode: null,
        stdout: stdoutBuf.toString("utf8"),
        stderr: stderrBuf.toString("utf8"),
        durationMs: Math.round(performance.now() - start),
        invokedCommand,
        truncated,
        errorCode: "spawn_error",
        errorMessage: err.message,
      });
    });

    child.on("close", (code) => {
      const durationMs = Math.round(performance.now() - start);

      if (timedOut) {
        finalize({
          success: false,
          exitCode: code,
          stdout: stdoutBuf.toString("utf8"),
          stderr: stderrBuf.toString("utf8"),
          durationMs,
          invokedCommand,
          truncated,
          errorCode: "timeout",
          errorMessage: `Claude CLI exceeded timeout of ${timeoutMs}ms and was terminated.`,
        });
        return;
      }

      if (code === 0) {
        finalize({
          success: true,
          exitCode: 0,
          stdout: stdoutBuf.toString("utf8"),
          stderr: stderrBuf.toString("utf8"),
          durationMs,
          invokedCommand,
          truncated,
        });
        return;
      }

      finalize({
        success: false,
        exitCode: code,
        stdout: stdoutBuf.toString("utf8"),
        stderr: stderrBuf.toString("utf8"),
        durationMs,
        invokedCommand,
        truncated,
        errorCode: "non_zero_exit",
        errorMessage: `Claude CLI exited with code ${code}.`,
      });
    });
  });
}
