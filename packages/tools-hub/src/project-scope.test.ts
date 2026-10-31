import { expect, test } from "bun:test";
import { WorkflowHttpError } from "./http-json.ts";
import { projectScopeCode } from "./project-scope.ts";

test("project scope failures expose only a refusal code, a safe code or the fallback", () => {
  expect(
    projectScopeCode(
      new WorkflowHttpError(403, "unspecified", "project_access_refused"),
    ),
  ).toBe("project_access_refused");
  expect(projectScopeCode(new Error("workflow_project_role_refused"))).toBe(
    "workflow_project_role_refused",
  );
  expect(projectScopeCode(new Error("ENOENT: /secret/path"))).toBe(
    "workflow_project_scope_unavailable",
  );
});
