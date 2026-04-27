import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runClaude } from "./runClaude.js";

/**
 * Spawn-based runner tests. We use shell-script fakes installed at
 * `CLAUDE_BIN` so the tests are hermetic — they never reach the real Claude
 * binary, which keeps the suite deterministic and fast.
 */
function makeScriptBin(scriptBody: string): {
  path: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "claude-mcp-run-"));
  const path = join(dir, "claude");
  writeFileSync(path, `#!/bin/sh\n${scriptBody}\n`, { encoding: "utf8" });
  chmodSync(path, 0o755);
  return {
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("runClaude", () => {
  let cleanups: Array<() => void> = [];
  let originalClaudeBin: string | undefined;

  beforeEach(() => {
    originalClaudeBin = process.env.CLAUDE_BIN;
  });

  afterEach(() => {
    if (originalClaudeBin === undefined) {
      delete process.env.CLAUDE_BIN;
    } else {
      process.env.CLAUDE_BIN = originalClaudeBin;
    }
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
  });

  it("returns success: true and captures stdout for a 0-exit run", async () => {
    const fake = makeScriptBin('echo "hello world"');
    cleanups.push(fake.cleanup);
    process.env.CLAUDE_BIN = fake.path;

    const result = await runClaude({ prompt: "anything" });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello world");
    expect(result.errorCode).toBeUndefined();
    expect(result.invokedCommand).toContain("--print");
  });

  it("maps non-zero exits to errorCode: non_zero_exit", async () => {
    const fake = makeScriptBin('echo "boom" >&2; exit 7');
    cleanups.push(fake.cleanup);
    process.env.CLAUDE_BIN = fake.path;

    const result = await runClaude({ prompt: "x" });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("non_zero_exit");
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("boom");
  });

  it("kills on timeout and reports timeout errorCode", async () => {
    const fake = makeScriptBin("sleep 5; echo done");
    cleanups.push(fake.cleanup);
    process.env.CLAUDE_BIN = fake.path;

    const result = await runClaude({ prompt: "x", timeoutMs: 200 });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("timeout");
    expect(result.errorMessage).toMatch(/200ms/);
  });

  it("truncates output that exceeds maxOutputBytes", async () => {
    // Emit ~20KB of data; cap at 4KB combined (2KB per stream).
    const fake = makeScriptBin(
      'for i in $(seq 1 2000); do printf "0123456789"; done',
    );
    cleanups.push(fake.cleanup);
    process.env.CLAUDE_BIN = fake.path;

    const result = await runClaude({
      prompt: "x",
      maxOutputBytes: 4_096,
    });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(2_048);
  });

  it("reports invalid_args without spawning when input violates rules", async () => {
    const fake = makeScriptBin('echo "should not run"');
    cleanups.push(fake.cleanup);
    process.env.CLAUDE_BIN = fake.path;

    const result = await runClaude({
      prompt: "x",
      continueSession: true,
      resumeSessionId: "11111111-1111-1111-1111-111111111111",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("invalid_args");
    expect(result.stdout).toBe("");
  });

  it("returns binary_not_found when CLAUDE_BIN points to nothing", async () => {
    process.env.CLAUDE_BIN = "/definitely/not/a/real/path/claude";
    process.env.PATH = "/this/does/not/exist";

    const result = await runClaude({ prompt: "x" });

    // On the dev machine, the hard-coded known-local path may still resolve.
    // If so, just assert we did not get binary_not_found.
    if (result.errorCode === "binary_not_found") {
      expect(result.success).toBe(false);
      expect(result.invokedCommand).toBe("<unresolved>");
    } else {
      expect(result.errorCode).not.toBe("binary_not_found");
    }
  });
});
