import { type, type ArkError, type ArkErrors } from "arktype";
import type { getLogger } from "@intx/log";
import { ProjectId } from "@corbits-builder/schemas/project";

// Agents see a rejection's reasons only in this list form.
export type ProjectErrorIssue = { path: string; message: string };
type Issues = readonly ProjectErrorIssue[];

export class ProjectError extends Error {
  readonly details: Record<string, unknown>;
  readonly issues?: readonly ProjectErrorIssue[];
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 502 | 503,
    readonly code: string,
    rawDetails:
      | { issues?: Issues | ArkErrors | string; [detail: string]: unknown }
      | readonly ProjectErrorIssue[] = {},
    options?: ErrorOptions,
  ) {
    super(code, options);
    if (Array.isArray(rawDetails)) {
      this.issues = rawDetails;
      this.details = { issues: rawDetails };
      return;
    }
    const { issues, ...details } = rawDetails as {
      issues?: Issues | ArkErrors | string;
      [detail: string]: unknown;
    };
    const listed = issues instanceof type.errors ? typeIssues(issues) : issues;
    if (Array.isArray(listed)) {
      this.issues = listed;
    }
    this.details =
      listed === undefined ? details : { ...details, issues: listed };
  }
}

/**
 * Answers with `answer`, logging the code of a ProjectError it throws before passing it on. A
 * refused run gets the reason in its answer and nothing else at the default log level shows it, so
 * the log records the code and `asked`, whose run asked, never what it sent.
 */
export async function logRefusals<T>(
  log: ReturnType<typeof getLogger>,
  message: string,
  asked: Record<string, string>,
  answer: () => Promise<T>,
): Promise<T> {
  try {
    return await answer();
  } catch (error) {
    if (error instanceof ProjectError)
      log.info(message, { code: error.code, ...asked });
    throw error;
  }
}
export const projectResource = (id: string) =>
  `sb-project:${ProjectId.assert(id)}`;

function issuePath(issue: ArkError, root: string | undefined): string {
  if (root === undefined) return issue.propString;
  if (!issue.propString || issue.propString.startsWith("["))
    return root + issue.propString;
  return root + "." + issue.propString;
}

// arktype's problem text and union expected text quote the submitted value; reasons name the rule only.
function issueMessage(issue: ArkError): string {
  if (issue.code === "union") return "is not one of the allowed values";
  if (issue.expected === "removed") return "is not allowed here";
  return ("must be " + issue.expected).slice(0, 200);
}

export const typeIssues = (errors: ArkErrors, root?: string): Issues =>
  [...errors]
    .flatMap((issue) => issue.flat)
    .slice(0, 10)
    .map((issue) => ({
      path: issuePath(issue, root),
      message: issueMessage(issue),
    }));
