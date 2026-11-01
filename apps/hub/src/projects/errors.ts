import type { ArkError, ArkErrors } from "arktype";
import { ProjectId } from "@corbits-builder/schemas/project";
export class ProjectError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 503,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(code, options);
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

// arktype's own problem text quotes the submitted value; reasons name the rule only.
const ruleText: Partial<Record<ArkError["code"], string>> = {
  union: "is not one of the allowed values",
  predicate: "is not allowed here",
};

// Agents see a rejection's reasons only in this list form.
export const typeIssues = (errors: ArkErrors, root?: string) =>
  [...errors].slice(0, 10).map((issue) => ({
    path: issuePath(issue, root),
    message: (ruleText[issue.code] ?? "must be " + issue.expected).slice(
      0,
      200,
    ),
  }));
