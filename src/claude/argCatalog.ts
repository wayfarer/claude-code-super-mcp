import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveClaudeBin } from "./resolveClaudeBin.js";

const execFileAsync = promisify(execFile);

/**
 * One parsed flag entry from `claude --help`. We deliberately keep the schema
 * loose because Claude's help output is not a stable contract — we extract
 * what we can and gracefully ignore the rest.
 */
export interface ClaudeFlagDoc {
  flag: string;
  description: string;
}

/**
 * In-memory cache for parsed help output. We use a singleton promise so
 * concurrent first-call invocations share a single subprocess.
 */
let cachedCatalog: Promise<ClaudeFlagDoc[]> | null = null;

/**
 * Lazy-loaded catalog of flags discovered in `claude --help`.
 *
 * The plan calls for lazy loading specifically because:
 *
 * 1. Startup parsing would add ~500ms to MCP server boot.
 * 2. A failure during startup parsing would silently degrade the entire
 *    server; deferring it means failures are localized to the (rare) call
 *    sites that actually need the catalog.
 *
 * The catalog is intentionally not used for argument validation — that's
 * `buildArgs.ts`'s job. It exists for diagnostic surfaces, debugging, and
 * future tools that want to introspect available flags at runtime.
 */
export function loadClaudeFlagCatalog(): Promise<ClaudeFlagDoc[]> {
  if (cachedCatalog) return cachedCatalog;
  cachedCatalog = (async () => {
    const resolved = resolveClaudeBin();
    const { stdout } = await execFileAsync(resolved.path, ["--help"], {
      timeout: 5_000,
      maxBuffer: 1_048_576,
    });
    return parseClaudeHelp(stdout);
  })();
  return cachedCatalog;
}

/**
 * Reset the cached catalog. Used by tests to ensure isolation; not exported
 * via the package public API.
 */
export function _resetClaudeFlagCatalogForTests(): void {
  cachedCatalog = null;
}

/**
 * Parse the "Options:" block of `claude --help` into discrete flag entries.
 *
 * The parser is intentionally permissive:
 *
 * - It anchors on the literal "Options:" header.
 * - It treats lines starting with whitespace + `-` as new entries.
 * - It folds wrapped continuation lines into the previous entry.
 * - It stops at the next top-level header ("Commands:" today, but anything
 *   matching `^[A-Z][A-Za-z ]+:$`).
 *
 * If the format changes radically in a future Claude version the catalog
 * may degrade to an empty array, but `buildArgs.ts` is the source of truth
 * for what we actually pass to the CLI, so this never blocks execution.
 */
export function parseClaudeHelp(helpText: string): ClaudeFlagDoc[] {
  const lines = helpText.split("\n");
  const result: ClaudeFlagDoc[] = [];

  let inOptions = false;
  let current: ClaudeFlagDoc | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");

    if (!inOptions) {
      if (line.trim() === "Options:") inOptions = true;
      continue;
    }

    if (line === "" || /^[A-Z][A-Za-z ]+:$/.test(line.trim())) {
      if (current) {
        result.push(current);
        current = null;
      }
      if (line !== "" && line.trim() !== "Options:") {
        break;
      }
      continue;
    }

    const flagMatch = line.match(/^\s+(-\S.*?)\s{2,}(.+)$/);
    if (flagMatch && flagMatch[1] && flagMatch[2] !== undefined) {
      if (current) result.push(current);
      current = {
        flag: flagMatch[1].trim(),
        description: flagMatch[2].trim(),
      };
      continue;
    }

    if (current && line.trim()) {
      current.description = `${current.description} ${line.trim()}`.trim();
    }
  }

  if (current) result.push(current);
  return result;
}
