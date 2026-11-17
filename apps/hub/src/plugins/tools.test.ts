import { expect, test } from "bun:test";
import { withoutResumeContext } from "../config/resume.ts";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { createExecuteTools, withPluginHint } from "./tools.ts";

test("a field-matched hint names the font picker alone after the person's words and strips back to them", () => {
  const hinted = withPluginHint("fields", "the font is ugly");
  expect(hinted).toStartWith("the font is ugly\n\nBuilder's note");
  expect(hinted).toContain(
    'execute({ plugin: "designer", action: "pick-fonts" })',
  );
  expect(hinted).not.toContain("pick-colours");
  expect(withoutResumeContext(hinted)).toBe("the font is ugly");
});

// "small" is a size, not a typeface, but trigger words match it anyway: the false positive to measure.
test("a trigger hint follows a whole trigger word only", () => {
  expect(withPluginHint("triggers", "the font is too small")).toContain(
    "- designer pick-fonts:",
  );
  expect(withPluginHint("triggers", "I want to confront this problem")).toBe(
    "I want to confront this problem",
  );
});

test("an unrelated message, or the hint switched off, is delivered unchanged", () => {
  for (const hint of ["triggers", "fields"] as const)
    expect(withPluginHint(hint, "add a login page")).toBe("add a login page");
  expect(withPluginHint("off", "the font is ugly")).toBe("the font is ugly");
});

const deployment = {
  source: {
    kind: "asset" as const,
    assetId: "asset",
    package: { format: "tarball" as const },
  },
  entry: "entry",
  pin: "@corbits-builder/coder@1.0.0",
  sourceOfferingIds: ["offering"],
  defaultSourceOfferingId: "offering",
};
const workflows = {
  "writer-product-requirements": deployment,
  "writer-build-plan": deployment,
  "writer-document": deployment,
  reviewer: deployment,
  coder: deployment,
  designer: deployment,
};

// The coordinator's check of an execute call before it runs, reading project values from a hub that
// answers with response.
function executeCheck(response: () => Response) {
  const fetch = async () => response();
  const capabilities = {
    resolve: () => ({ resolve: async () => ({ kind: "http", fetch }) }),
  } as unknown as RuntimeCapabilities;
  const { checkCall } = createExecuteTools({
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows,
    maxResultBytes: 16384,
  })({ capabilities } as never);
  if (!checkCall) throw new Error("the execute tools check no calls");
  return {
    check: (action: string, input: Record<string, unknown>) =>
      checkCall({
        id: "call",
        name: "execute",
        arguments: { plugin: "designer", action, input },
      }),
  };
}

test("an execute call of designer pick-fonts does not pause when the project's fonts cannot be read", async () => {
  const { check } = executeCheck(() =>
    Response.json({ code: "forbidden" }, { status: 403 }),
  );
  await expect(check("pick-fonts", {})).rejects.toThrow(
    "forbidden: the hub refused the call (HTTP 403)",
  );
});

test("the question tool the coordinator is offered describes each of its fields in Builder's words", () => {
  const { definitions } = createExecuteTools()({} as never);
  const question = definitions.find(({ name }) => name === "question");
  const described = { description: expect.stringMatching(/\S/) };
  expect(question?.inputSchema).toMatchObject({
    properties: {
      questions: {
        description: expect.stringMatching(/\S/),
        items: {
          properties: {
            question: described,
            header: described,
            multiple: described,
            custom: described,
            options: {
              description: expect.stringMatching(/\S/),
              items: {
                properties: { label: described, description: described },
              },
            },
          },
        },
      },
    },
  });
});
