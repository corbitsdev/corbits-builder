import type { ArtifactRef } from "@corbits-builder/schemas/artifact";
import {
  prepareDesignSubmission,
  readDesignFiles,
  type PreparedDesignSubmission,
} from "../artifacts/design-draft.ts";
import { relative, resolve, sep } from "node:path";
import type { ToolCall, ToolResult } from "@intx/types/runtime";
import {
  checkDesignDefinition,
  DESIGN_DOC,
  designChangedDuringCheck,
  designCheckRunning,
  DESIGNS,
} from "../config/design.ts";

type Run = (
  signal: AbortSignal,
) => Promise<{ exitCode: number | null; output: string }>;
type FileDesign = (
  submission: PreparedDesignSubmission,
  signal: AbortSignal,
) => Promise<ArtifactRef>;
type Submitted = { passed: true; checklist: string; artifact: ArtifactRef };
type Result = Submitted | { passed: false; checklist: string };
export type DesignSubmission = ReturnType<typeof createDesignSubmission>;

export const CHECK_DESIGN_TOOL = checkDesignDefinition.name;

export const touchesDesigns = (workspace: string, path: string) => {
  const at = relative(workspace, resolve(workspace, path));
  return at === DESIGN_DOC || at.startsWith(DESIGNS + sep);
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Every check_design result is check-app's output, with a validation or filing problem merged in or
// the filed receipt appended, so the designer sees all of it from one call.
function checklist(
  output: string,
  outcome?: { issue: string } | { artifact: ArtifactRef },
): string {
  const trimmed = output.trim();
  if (!outcome) return trimmed;
  if ("artifact" in outcome)
    return `${trimmed}\nFiled design_option: ${JSON.stringify(outcome.artifact)}`;
  const detail = outcome.issue.replace(/^invalid_design:\s*/, "");
  const rewritten = trimmed.replace(
    /^check passed\b[^\n]*/,
    `check failed: ${outcome.issue}`,
  );
  if (trimmed.includes(detail)) return rewritten;
  return `${rewritten}\n✗ ${outcome.issue}`;
}

export function createDesignSubmission(
  workspace: string,
  run: Run,
  file: FileDesign,
) {
  let active: AbortController | undefined;
  let lastSuccess:
    | {
        files: Awaited<ReturnType<typeof readDesignFiles>>;
        result: Submitted;
      }
    | undefined;

  const execute = async (signal: AbortSignal): Promise<Result> => {
    let files: Awaited<ReturnType<typeof readDesignFiles>>;
    try {
      files = await readDesignFiles(workspace);
    } catch (error) {
      signal.throwIfAborted();
      // A model retries an absolute path it is shown verbatim, so name the file from the workspace.
      const message = messageOf(error).replaceAll(workspace + sep, "");
      return { passed: false, checklist: `check failed: ${message}` };
    }
    signal.throwIfAborted();
    if (lastSuccess && Bun.deepEquals(lastSuccess.files, files, true))
      return lastSuccess.result;
    let checked: { exitCode: number | null; output: string };
    try {
      checked = await run(signal);
    } catch (error) {
      signal.throwIfAborted();
      checked = {
        exitCode: 1,
        output: `check-app did not run: ${messageOf(error)}`,
      };
    }
    signal.throwIfAborted();
    try {
      const submission = prepareDesignSubmission(files);
      if (checked.exitCode !== 0)
        return { passed: false, checklist: checklist(checked.output) };
      if (!Bun.deepEquals(await readDesignFiles(workspace), files, true))
        return { passed: false, checklist: designChangedDuringCheck };
      signal.throwIfAborted();
      // The hub answers content it already holds with that version, so raw edits that normalize to
      // filed content are still checked but add none.
      const artifact = await file(submission, signal);
      const result: Submitted = {
        passed: true,
        artifact,
        checklist: checklist(checked.output, { artifact }),
      };
      lastSuccess = { files, result };
      return result;
    } catch (error) {
      signal.throwIfAborted();
      return {
        passed: false,
        checklist: checklist(checked.output, { issue: messageOf(error) }),
      };
    }
  };

  const submit = async (caller: AbortSignal): Promise<Result> => {
    caller.throwIfAborted();
    active = new AbortController();
    try {
      return await execute(AbortSignal.any([caller, active.signal]));
    } finally {
      active = undefined;
    }
  };

  return {
    async run(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
      // Interchange runs one reply's tool calls in parallel. The refusal carries no check detail, so
      // the director keeps judging the reply by the check that ran.
      if (active) return { callId: call.id, content: designCheckRunning };
      const result = await submit(signal);
      return {
        callId: call.id,
        content: result.checklist,
        detail: { checkPassed: result.passed, filed: result.passed },
      };
    },
    dispose() {
      active?.abort();
    },
  };
}
