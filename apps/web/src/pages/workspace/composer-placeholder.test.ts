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
  questionsOpen?: boolean;
  screenReply?: string;
  nothingFiled?: boolean;
  status?: ProjectStatus;
}): string {
  return composerPlaceholder({
    approvalOpen: input.approvalOpen ?? false,
    questionsOpen: input.questionsOpen ?? false,
    screenReply: input.screenReply,
    nothingFiled: input.nothingFiled ?? false,
    status: input.status,
  });
}

describe("composer placeholder", () => {
  test("work under way beats a running app and a failure, and names no one", () => {
    expect(
      placeholder({
        status: standing({
          working: [
            { role: "writer", state: "starting" },
            { role: "reviewer", state: "working" },
          ],
          app: { state: "running" },
          failedSpecialist: "coder",
        }),
      }),
    ).toBe("What do you want to say…");
  });

  test("work that is only starting counts as under way", () => {
    expect(
      placeholder({
        nothingFiled: true,
        status: standing({
          working: [{ role: "designer", state: "starting" }],
          app: { state: "failed" },
        }),
      }),
    ).toBe("What do you want to say…");
  });

  test("a running app beats a failure", () => {
    expect(
      placeholder({
        nothingFiled: true,
        status: standing({
          app: { state: "running" },
          failedSpecialist: "writer",
        }),
      }),
    ).toBe("What needs to change…");
  });

  test("a failed app beats an empty project", () => {
    expect(
      placeholder({
        nothingFiled: true,
        status: standing({ app: { state: "failed" } }),
      }),
    ).toBe("What needs fixing…");
  });

  test("a failed specialist beats an empty project", () => {
    expect(
      placeholder({
        nothingFiled: true,
        status: standing({
          app: { state: "stopped" },
          failedSpecialist: "designer",
        }),
      }),
    ).toBe("What needs fixing…");
  });

  test("an empty project beats the fallback", () => {
    expect(
      placeholder({
        nothingFiled: true,
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
    ).toBe("What do you want to say…");
  });

  test("an open approval keeps the approval placeholder", () => {
    expect(
      placeholder({
        approvalOpen: true,
        nothingFiled: true,
        status: standing({
          working: [{ role: "coder", state: "working" }],
          app: { state: "failed", reason: "crashed" },
          failedSpecialist: "coder",
        }),
      }),
    ).toBe(wording.approval.composerPlaceholder);
  });

  test("open questions point at the card, after an open approval", () => {
    const status = standing({ working: [{ role: "coder", state: "working" }] });
    expect(placeholder({ questionsOpen: true, status })).toBe(
      wording.questions.composerPlaceholder,
    );
    expect(
      placeholder({ approvalOpen: true, questionsOpen: true, status }),
    ).toBe(wording.approval.composerPlaceholder);
  });
});
