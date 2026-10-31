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
