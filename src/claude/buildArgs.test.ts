import { describe, expect, it } from "vitest";
import { buildClaudeArgs, InvalidClaudeArgsError } from "./buildArgs.js";

describe("buildClaudeArgs", () => {
  it("always prepends --print as the first flag", () => {
    const args = buildClaudeArgs({ prompt: "hello" });
    expect(args[0]).toBe("--print");
  });

  it("places the positional prompt last", () => {
    const args = buildClaudeArgs({
      prompt: "do thing",
      model: "sonnet",
      outputFormat: "json",
    });
    expect(args[args.length - 1]).toBe("do thing");
  });

  it("emits structured flags in canonical CLI form", () => {
    const args = buildClaudeArgs({
      prompt: "go",
      model: "opus",
      fallbackModel: "sonnet",
      outputFormat: "json",
      permissionMode: "acceptEdits",
      allowedTools: ["Edit", "Bash(git:*)"],
      disallowedTools: ["WebFetch"],
      appendSystemPrompt: "Be concise.",
      addDirs: ["/a", "/b"],
      mcpConfig: ["/path/to/mcp.json"],
      dangerouslySkipPermissions: true,
    });

    expect(args).toContain("--model");
    expect(args).toContain("opus");
    expect(args).toContain("--fallback-model");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("acceptEdits");
    expect(args).toContain("--allowed-tools");
    expect(args).toContain("Bash(git:*)");
    expect(args).toContain("--disallowed-tools");
    expect(args).toContain("WebFetch");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("Be concise.");
    expect(args).toContain("--add-dir");
    expect(args).toContain("/a");
    expect(args).toContain("/b");
    expect(args).toContain("--mcp-config");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("appends rawArgs after structured args but before the prompt", () => {
    const args = buildClaudeArgs({
      prompt: "x",
      model: "sonnet",
      rawArgs: ["--debug", "api"],
    });

    const debugIdx = args.indexOf("--debug");
    const modelIdx = args.indexOf("--model");
    const promptIdx = args.indexOf("x");

    expect(modelIdx).toBeGreaterThan(0);
    expect(debugIdx).toBeGreaterThan(modelIdx);
    expect(promptIdx).toBeGreaterThan(debugIdx);
  });

  it("rejects continueSession + resumeSessionId as mutually exclusive", () => {
    expect(() =>
      buildClaudeArgs({
        prompt: "hi",
        continueSession: true,
        resumeSessionId: "11111111-1111-1111-1111-111111111111",
      }),
    ).toThrow(InvalidClaudeArgsError);
  });

  it("rejects forkSession without continue/resume context", () => {
    expect(() =>
      buildClaudeArgs({ prompt: "hi", forkSession: true }),
    ).toThrow(InvalidClaudeArgsError);
  });

  it("accepts forkSession when paired with continueSession", () => {
    const args = buildClaudeArgs({
      prompt: "hi",
      continueSession: true,
      forkSession: true,
    });
    expect(args).toContain("--continue");
    expect(args).toContain("--fork-session");
  });

  it("rejects malformed sessionId", () => {
    expect(() =>
      buildClaudeArgs({ prompt: "hi", sessionId: "not-a-uuid" }),
    ).toThrow(InvalidClaudeArgsError);
  });

  it("accepts well-formed UUID sessionId", () => {
    const args = buildClaudeArgs({
      prompt: "hi",
      sessionId: "11111111-1111-1111-1111-111111111111",
    });
    expect(args).toContain("--session-id");
    expect(args).toContain("11111111-1111-1111-1111-111111111111");
  });

  it("omits flags when their inputs are absent", () => {
    const args = buildClaudeArgs({ prompt: "x" });
    expect(args).toEqual(["--print", "x"]);
  });
});
