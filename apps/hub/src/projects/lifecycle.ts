import { ProjectError } from "./errors.ts";

type StatusFilter = "active" | "archived" | "all";

// The list default is the working set; archived projects are explicit, and
// "all" is the only way to see both without two requests.
export function parseStatusFilter(raw: string | undefined): StatusFilter {
  if (raw === undefined) return "active";
  if (raw === "active" || raw === "archived" || raw === "all") return raw;
  throw new ProjectError(400, "invalid_status_filter");
}
