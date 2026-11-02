import { type, type ArkError, type ArkErrors } from "arktype";
import { ProjectId } from "@corbits-builder/schemas/project";

// Agents see a rejection's reasons only in this list form.
type Issues = readonly { path: string; message: string }[];

export class ProjectError extends Error {
  readonly details: Record<string, unknown>;
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 503,
    readonly code: string,
    {
      issues,
      ...details
    }: { issues?: Issues | ArkErrors; [detail: string]: unknown } = {},
    options?: ErrorOptions,
  ) {
    super(code, options);
    const listed = issues instanceof type.errors ? typeIssues(issues) : issues;
    this.details =
      listed === undefined ? details : { ...details, issues: listed };
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
