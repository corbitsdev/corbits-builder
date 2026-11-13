import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { hasCode } from "@intx/types";
import { withDesignTokens } from "../artifacts/design-tokens.ts";
import { DESIGN_STYLES } from "../artifacts/design-tweaks.ts";

export const DESIGNS = join(".builder", "designs");

export interface FiledDesignArtifact {
  artifactId: string;
  kind: string;
  version: number;
  sha256: string;
  // Whether the hub chose it as the design itself, approvals being left to Builder.
  designChosen: boolean;
}

type Result = {
  fingerprint: string;
  passed: boolean;
  checklist: string;
  artifact?: FiledDesignArtifact;
  filingError?: unknown;
};
type Run = (
  signal: AbortSignal,
) => Promise<{ exitCode: number | null; output: string }>;
type DesignFiler = (signal: AbortSignal) => Promise<FiledDesignArtifact>;
export type DesignCheck = ReturnType<typeof createDesignCheck>;

// By workspace. The designer's coding tools run the check and file_design_option waits on it; both
// tool packages load into the one workflow child of the designer's bundle
// (unified-execution-host-design.md, "The tool-execution locus"; build-packages.ts bundles a role).
const checks = new Map<string, DesignCheck>();
const filers = new Map<string, DesignFiler>();
export const designCheckFor = (workspace: string) => checks.get(workspace);
export function registerDesignFiler(workspace: string, filer: DesignFiler) {
  filers.set(resolve(workspace), filer);
}

async function findDesignFiler(
  workspace: string,
): Promise<DesignFiler | undefined> {
  const direct = filers.get(workspace) ?? filers.get(resolve(workspace));
  if (direct) return direct;
  for (const [candidate, filer] of filers) {
    try {
      if ((await realpath(candidate)) === workspace) {
        filers.set(workspace, filer);
        return filer;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

// check-app also reads the design document beside the mockup.
const DESIGN_DOC = join(".builder", "DESIGN.md");
const DESIGN_STYLES_PATH = join(".builder", DESIGN_STYLES);
const DESIGN_INDEX_PATH = join(".builder", "designs", "index.html");
// Prose in angle brackets, like <App name>; HTML tags carry attributes and code is stripped first.
const PLACEHOLDER = /<[A-Za-z][^<>=`"]*\s[^<>=`"]*>/g;

async function readTextIfPresent(path: string): Promise<string | undefined> {
  return (await readIfPresent(path))?.toString("utf8");
}

async function readIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (hasCode(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function validateDesignWorkspace(
  workspace: string,
): Promise<string | undefined> {
  const doc = await readTextIfPresent(join(workspace, DESIGN_DOC));
  const styles = await readTextIfPresent(join(workspace, DESIGN_STYLES_PATH));
  const index = await readTextIfPresent(join(workspace, DESIGN_INDEX_PATH));
  if (doc === undefined || styles === undefined || index === undefined)
    return `invalid_design: .builder needs DESIGN.md, designs/index.html and ${DESIGN_STYLES}`;
  const prose = doc.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const placeholders = [
    ...new Set(
      Array.from(prose.matchAll(PLACEHOLDER), ([match]) =>
        match.replace(/\s+/g, " ").slice(0, 40),
      ),
    ),
  ];
  if (placeholders.length > 0)
    return `invalid_design: DESIGN.md still has ${placeholders.length} template placeholder(s): ${placeholders.slice(0, 5).join(", ")}`;
  try {
    withDesignTokens(doc, styles);
  } catch (error) {
    return `invalid_design: ${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

function withValidationIssue(output: string, issue: string): string {
  const trimmed = output.trim();
  const detail = issue.replace(/^invalid_design:\s*/, "");
  const rewritten = trimmed.replace(
    /^check passed\b[^\n]*/,
    `check failed: ${issue}`,
  );
  if (trimmed.includes(detail)) return rewritten;
  return `${rewritten}\n✗ ${issue}`;
}

export const CHECK_DESIGN_TOOL = "check_design";
export const checkDesignDefinition = {
  name: CHECK_DESIGN_TOOL,
  description: `Check the design as it is now and, when it passes, file it as your design concept's option for the person to compare. It runs check-app: it serves ${DESIGNS} in a headless browser, opens its screens at desktop and phone widths, checks that ${DESIGN_DOC} is filled in, and that the look is moved off the kit's starting point. Call it once the screens and ${DESIGN_DOC} are written, and again after each fix. It returns the checklist: "check passed" with the filed option on its last line, or what to fix. A pass files the design, so file_design_option is not needed after it, and the same files are never filed twice.`,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

export const touchesDesigns = (workspace: string, path: string) => {
  const at = relative(workspace, resolve(workspace, path));
  return at === DESIGN_DOC || at.startsWith(DESIGNS + sep);
};

/**
 * check-app on a designer workspace's mockup, run on demand for checking and filing. A result
 * belongs to the exact files it saw.
 */
export function createDesignCheck(workspace: string, run: Run) {
  let latest: Result | undefined;
  let filed: { fingerprint: string; artifact: FiledDesignArtifact } | undefined;
  let filing:
    | { fingerprint: string; done: Promise<FiledDesignArtifact> }
    | undefined;
  let running:
    | {
        fingerprint: string;
        controller: AbortController;
        done: Promise<Result | undefined>;
      }
    | undefined;

  const fingerprint = async () => {
    const hash = createHash("sha256");
    const root = join(workspace, DESIGNS);
    let paths: string[];
    try {
      paths = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root }));
    } catch (error) {
      if (!(hasCode(error) && error.code === "ENOENT")) throw error;
      paths = [];
    }
    for (const path of paths.sort())
      hash
        .update(`${path}\0`)
        .update((await readIfPresent(join(root, path))) ?? "");
    hash
      .update(`\0${DESIGN_DOC}\0`)
      .update((await readIfPresent(join(workspace, DESIGN_DOC))) ?? "");
    return hash.digest("hex");
  };

  const runCheck = async (
    print: string,
    controller: AbortController,
  ): Promise<Result | undefined> => {
    try {
      let ran: { exitCode: number | null; output: string };
      try {
        ran = await run(controller.signal);
      } catch (error) {
        ran = {
          exitCode: 1,
          output: `check-app did not run: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const issue = await validateDesignWorkspace(workspace);
      if (controller.signal.aborted) return undefined;
      const result: Result = issue
        ? {
            fingerprint: print,
            passed: false,
            checklist: withValidationIssue(ran.output, issue),
          }
        : {
            fingerprint: print,
            passed: ran.exitCode === 0,
            checklist: ran.output.trim(),
          };
      latest = result;
      return result;
    } finally {
      if (running?.controller === controller) running = undefined;
    }
  };

  // The result for the files as they are now: the latest one if they have not changed, else a run.
  // undefined when a newer change superseded the run.
  const check = async (): Promise<Result | undefined> => {
    const print = await fingerprint();
    if (latest?.fingerprint === print) return latest;
    if (running?.fingerprint === print) return running.done;
    running?.controller.abort();
    const controller = new AbortController();
    const done = runCheck(print, controller);
    running = { fingerprint: print, controller, done };
    return done;
  };

  const designCheck = {
    /** The result for the design as it is now, waiting for a run when there is none. */
    async current(signal: AbortSignal): Promise<Result> {
      for (;;) {
        signal.throwIfAborted();
        const result = await check();
        if (!result) continue;
        if (!result.passed) return result;
        if (filed?.fingerprint === result.fingerprint) {
          return {
            ...result,
            artifact: filed.artifact,
            checklist: `${result.checklist}\nFiled design_option: ${JSON.stringify(filed.artifact)}`,
          };
        }
        const filer = await findDesignFiler(workspace);
        if (!filer) return result;
        try {
          if (filing?.fingerprint !== result.fingerprint)
            filing = {
              fingerprint: result.fingerprint,
              done: filer(signal),
            };
          const artifact = await filing.done;
          filed = { fingerprint: result.fingerprint, artifact };
          return {
            ...result,
            artifact,
            checklist: `${result.checklist}\nFiled design_option: ${JSON.stringify(artifact)}`,
          };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return {
            fingerprint: result.fingerprint,
            passed: false,
            checklist: withValidationIssue(result.checklist, reason),
            filingError: error,
          };
        } finally {
          filing = undefined;
        }
      }
    },
    dispose() {
      running?.controller.abort();
      checks.delete(workspace);
      filers.delete(workspace);
    },
  };
  checks.set(workspace, designCheck);
  return designCheck;
}
