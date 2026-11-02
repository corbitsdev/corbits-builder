import { ProjectId } from "@corbits-builder/schemas/project";

export type ProjectErrorIssue = { path: string; message: string };

export class ProjectError extends Error {
  readonly details: Record<string, unknown>;
  readonly issues?: readonly ProjectErrorIssue[];
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 503,
    readonly code: string,
    details: Record<string, unknown> | readonly ProjectErrorIssue[] = {},
    options?: ErrorOptions,
  ) {
    super(code, options);
    if (Array.isArray(details)) {
      this.issues = details;
      this.details = { issues: details };
    } else {
      this.details = details as Record<string, unknown>;
    }
  }
}
export const projectResource = (id: string) =>
  `sb-project:${ProjectId.assert(id)}`;
