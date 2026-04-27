import { describe, expect, it } from "vitest";
import { parseClaudeHelp } from "./argCatalog.js";

const SAMPLE_HELP = `Usage: claude [options] [command] [prompt]

Claude Code

Arguments:
  prompt                                            Your prompt

Options:
  -d, --debug [filter]                              Enable debug mode
  --verbose                                         Override verbose mode setting
  -p, --print                                       Print response and exit
  --output-format <format>                          Output format
                                                    (choices: "text", "json")
  -h, --help                                        Display help

Commands:
  mcp                                               Configure MCP servers
`;

describe("parseClaudeHelp", () => {
  it("extracts flags from the Options block", () => {
    const docs = parseClaudeHelp(SAMPLE_HELP);
    const flagNames = docs.map((d) => d.flag);
    expect(flagNames).toContain("-d, --debug [filter]");
    expect(flagNames).toContain("--verbose");
    expect(flagNames).toContain("-p, --print");
    expect(flagNames).toContain("--output-format <format>");
    expect(flagNames).toContain("-h, --help");
  });

  it("folds wrapped continuation lines into the previous flag's description", () => {
    const docs = parseClaudeHelp(SAMPLE_HELP);
    const outputFormat = docs.find((d) => d.flag.startsWith("--output-format"));
    expect(outputFormat).toBeDefined();
    expect(outputFormat?.description).toContain("Output format");
    expect(outputFormat?.description).toContain('"text"');
  });

  it("stops parsing at the next top-level header", () => {
    const docs = parseClaudeHelp(SAMPLE_HELP);
    expect(docs.every((d) => !d.flag.includes("mcp"))).toBe(true);
  });

  it("returns an empty array when no Options section is present", () => {
    expect(parseClaudeHelp("just some text without options")).toEqual([]);
  });
});
