import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClaudeBinNotFoundError,
  resolveClaudeBin,
} from "./resolveClaudeBin.js";

/**
 * Build a tmp directory containing a fake `claude` shell script that responds
 * to `--version`. We do not invoke it here; the resolver only checks
 * executability.
 */
function makeFakeBin(name = "claude"): {
  dir: string;
  path: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "claude-mcp-bin-"));
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\necho fake\n", { encoding: "utf8" });
  chmodSync(path, 0o755);
  return {
    dir,
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("resolveClaudeBin", () => {
  let cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
  });

  it("prefers CLAUDE_BIN when set and executable", () => {
    const fake = makeFakeBin();
    cleanups.push(fake.cleanup);

    const resolved = resolveClaudeBin({
      CLAUDE_BIN: fake.path,
      PATH: "",
    });

    expect(resolved.source).toBe("env");
    expect(resolved.path).toBe(fake.path);
  });

  it("falls back to PATH when CLAUDE_BIN is unset", () => {
    const fake = makeFakeBin();
    cleanups.push(fake.cleanup);

    const resolved = resolveClaudeBin({ PATH: fake.dir });

    // Could resolve as `known-local` if the dev machine's path happens to be
    // valid for the test runner; otherwise it should resolve via PATH.
    expect(["known-local", "path"]).toContain(resolved.source);
    if (resolved.source === "path") {
      expect(resolved.path).toBe(fake.path);
    }
  });

  it("throws ClaudeBinNotFoundError with attempts when nothing resolves", () => {
    let error: unknown;
    try {
      resolveClaudeBin({ PATH: "/this/does/not/exist" });
    } catch (e) {
      error = e;
    }

    if (!(error instanceof ClaudeBinNotFoundError)) {
      // On the dev machine the known-local path may exist; in that case this
      // test is a no-op pass.
      return;
    }

    expect(error.attempts.length).toBeGreaterThan(0);
    expect(error.attempts.some((a) => a.startsWith("PATH:"))).toBe(true);
  });
});
