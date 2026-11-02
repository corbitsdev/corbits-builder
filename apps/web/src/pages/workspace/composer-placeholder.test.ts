import { describe, expect, test } from "bun:test";
import type { ProjectStatus } from "@corbits-builder/schemas/project-status";
import { wording } from "../../config.ts";
import { composerPlaceholder } from "./composer-placeholder.ts";

function standing(input: {
  working?: ProjectStatus["working"];
  app?: ProjectStatus["app"];
  failedSpecialist?: NonNullable<ProjectStatus["failedSpecialist"]>;
}): ProjectStatus {
  return {
    working: input.working ?? [],
    now: "Standing.",
    app: input.app ?? { state: "not_started" },
    next: { text: "Reply to the coordinator" },
    ...(input.failedSpecialist === undefined
      ? {}
      : { failedSpecialist: input.failedSpecialist }),
  };
}

function placeholder(input: {
  approvalOpen?: boolean;
  chatFirst?: boolean;
  status?: ProjectStatus;
}): string {
  return composerPlaceholder({
    approvalOpen: input.approvalOpen ?? false,
    chatFirst: input.chatFirst ?? false,
    status: input.status,
  });
}

describe("composer placeholder", () => {
  test("a working role beats a running app, and the first working role is named", () => {
    expect(
      placeholder({
        status: standing({
          working: [
            { role: "writer", state: "starting" },
            { role: "reviewer", state: "working" },
            { role: "designer", state: "working" },
          ],
          app: { state: "running" },
          failedSpecialist: "coder",
        }),
      }),
    ).toBe("I'll pass this to the reviewer…");
  });

  test("a starting role is named when nobody is working", () => {
    expect(
      placeholder({
        status: standing({
          working: [
            { role: "coordinator", state: "unknown" },
            { role: "writer", state: "starting" },
            { role: "designer", state: "starting" },
          ],
          app: { state: "running" },
        }),
      }),
    ).toBe("I'll pass this to the writer…");
  });

  test("the coder is called the app builder", () => {
    expect(
      placeholder({
        status: standing({
          working: [{ role: "coder", state: "working" }],
          app: { state: "running" },
        }),
      }),
    ).toBe("I'll pass this to the app builder…");
  });

  test("a running app beats a failure", () => {
    expect(
      placeholder({
        chatFirst: true,
        status: standing({
          app: { state: "running" },
          failedSpecialist: "writer",
        }),
      }),
    ).toBe("What to change…");
  });

  test("a failed app beats an empty project", () => {
    expect(
      placeholder({
        chatFirst: true,
        status: standing({ app: { state: "failed" } }),
      }),
    ).toBe("What to fix…");
  });

  test("a failed specialist beats an empty project", () => {
    expect(
      placeholder({
        chatFirst: true,
        status: standing({
          app: { state: "stopped" },
          failedSpecialist: "designer",
        }),
      }),
    ).toBe("What to fix…");
  });

  test("an empty project beats the fallback", () => {
    expect(
      placeholder({
        chatFirst: true,
        status: standing({
          working: [{ role: "writer", state: "unknown" }],
          app: { state: "not_started" },
        }),
      }),
    ).toBe("What are you making…");
  });

  test("anything else asks for a reply", () => {
    expect(
      placeholder({
        status: standing({
          working: [{ role: "coder", state: "unknown" }],
          app: { state: "stopped" },
        }),
      }),
    ).toBe("Reply here…");
  });

  test("an open approval keeps the approval placeholder", () => {
    expect(
      placeholder({
        approvalOpen: true,
        chatFirst: true,
        status: standing({
          working: [{ role: "coder", state: "working" }],
          app: { state: "failed", reason: "crashed" },
          failedSpecialist: "coder",
        }),
      }),
    ).toBe(wording.approval.composerPlaceholder);
  });
});
