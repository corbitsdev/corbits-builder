import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export const DESIGNS = join(".builder", "designs");
// A designer writes a screen in several calls; the check starts once they pause.
const SETTLE_MS = 2_000;

type Result = { fingerprint: string; passed: boolean; checklist: string };
type Run = (
  signal: AbortSignal,
) => Promise<{ exitCode: number | null; output: string }>;
export type DesignCheck = ReturnType<typeof createDesignCheck>;

// By workspace. The designer's coding tools run the check and file_design_option waits on it; both
// tool packages load into the one workflow child of the designer's bundle
// (unified-execution-host-design.md, "The tool-execution locus"; the hub's build-packages.ts bundles a role).
const checks = new Map<string, DesignCheck>();
export const designCheckFor = (workspace: string) => checks.get(workspace);

// check-app also reads the design document beside the mockup.
const DESIGN_DOC = join(".builder", "DESIGN.md");

export const CHECK_DESIGN_TOOL = "check_design";
export const checkDesignDefinition = {
  name: CHECK_DESIGN_TOOL,
  description: `Runs check-app on the design as it is now: it serves ${DESIGNS} in a headless browser, opens its screens at desktop and phone widths, checks that ${DESIGN_DOC} is filled in, and that the look is moved off the kit's starting point. The harness also runs it after each design write and shows the result with a later write, so call this to see the checklist for the design as it is now; the design is ready to file once it reads "check passed".`,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

export const touchesDesigns = (workspace: string, path: string) => {
  const at = relative(workspace, resolve(workspace, path));
  return at === DESIGN_DOC || at.startsWith(DESIGNS + sep);
};

/**
 * check-app on a designer workspace's mockup, run by the harness: after design writes settle,
 * restarted when more arrive, and on demand for filing. A result belongs to the exact files it saw.
 */
export function createDesignCheck(workspace: string, run: Run) {
  let latest: Result | undefined;
  let heard: Result | undefined;
  let running:
    | {
        fingerprint: string;
        controller: AbortController;
        done: Promise<Result | undefined>;
      }
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fingerprint = async () => {
    const hash = createHash("sha256");
    const root = join(workspace, DESIGNS);
    const paths = await Array.fromAsync(
      new Bun.Glob("**/*").scan({ cwd: root }),
    ).catch(() => [] as string[]);
    for (const path of paths.sort())
      hash
        .update(`${path}\0`)
        .update(await readFile(join(root, path)).catch(() => ""));
    hash
      .update(`\0${DESIGN_DOC}\0`)
      .update(await readFile(join(workspace, DESIGN_DOC)).catch(() => ""));
    return hash.digest("hex");
  };

  // The result for the files as they are now: the latest one if they have not changed, else a run.
  // undefined when a newer change superseded the run.
  const check = async (): Promise<Result | undefined> => {
    timer = undefined;
    const print = await fingerprint();
    if (latest?.fingerprint === print) return latest;
    if (running?.fingerprint === print) return running.done;
    running?.controller.abort();
    const controller = new AbortController();
    const done = run(controller.signal)
      .then(
        ({ exitCode, output }) => ({
          fingerprint: print,
          passed: exitCode === 0,
          checklist: output.trim(),
        }),
        (error: unknown) => ({
          fingerprint: print,
          passed: false,
          checklist: `check-app did not run: ${error instanceof Error ? error.message : String(error)}`,
        }),
      )
      .then((result) => {
        if (controller.signal.aborted) return undefined;
        latest = result;
        return result;
      })
      .finally(() => {
        if (running?.controller === controller) running = undefined;
      });
    running = { fingerprint: print, controller, done };
    return done;
  };

  const designCheck = {
    /** A design file changed: drop the run in progress and check again once writes settle. */
    changed() {
      clearTimeout(timer);
      running?.controller.abort();
      timer = setTimeout(() => void check(), SETTLE_MS);
    },
    /** The checklist of the latest run the agent has not been shown, with what design it saw. */
    async unheard() {
      if (!latest || latest === heard) return "";
      heard = latest;
      const current = latest.fingerprint === (await fingerprint());
      return `check-app ${DESIGNS}, run by the harness on ${current ? "the current design" : "the design before the latest changes, which are checked next"}:\n${latest.checklist}`;
    },
    /** The result for the design as it is now, waiting for a run when there is none. */
    async current(signal: AbortSignal): Promise<Result> {
      clearTimeout(timer);
      for (;;) {
        signal.throwIfAborted();
        const result = await check();
        if (result) return (heard = result);
      }
    },
    dispose() {
      clearTimeout(timer);
      running?.controller.abort();
      checks.delete(workspace);
    },
  };
  checks.set(workspace, designCheck);
  return designCheck;
}
