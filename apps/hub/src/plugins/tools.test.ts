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
  const asked: string[] = [];
  const fetch = async (path: string) => {
    asked.push(path);
    return response();
  };
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
    asked,
    check: (action: string, input: Record<string, unknown>) =>
      checkCall({
        id: "call",
        name: "execute",
        arguments: { plugin: "designer", action, input },
      }),
  };
}

const fontsInUse = () =>
  Response.json({
    values: { "look.font-primary": "Inter", "look.font-secondary": null },
  });

test("an execute call of designer pick-fonts the screen can draw pauses on it for its answer, checked against the project's fonts", async () => {
  const { asked, check } = executeCheck(fontsInUse);
  expect(
    await check("pick-fonts", { proposed: { primary: "Fraunces" } }),
  ).toEqual({
    plugin: "designer",
    action: "pick-fonts",
    input: { proposed: { primary: "Fraunces" } },
    resume: "result",
  });
  expect(asked).toEqual([
    "/api/tenants/tenant/projects/project/values?keys=plugins.build-web-app",
    "/api/tenants/tenant/projects/project/values?keys=look.font-primary%2Clook.font-secondary",
  ]);
  expect(await check("pick-fonts", { proposed: { primary: "Inter" } })).toBe(
    [
      "designer pick-fonts was not shown. One field is wrong.",
      "",
      'proposed: "Inter" is already the font in use.',
      "",
      'Your other fields were fine: list "all".',
      "Call again proposing a different font, or with no proposal to let the person choose.",
    ].join("\n"),
  );
});

test("an execute call of designer pick-fonts does not pause when the project's fonts cannot be read", async () => {
  const { check } = executeCheck(() =>
    Response.json({ code: "forbidden" }, { status: 403 }),
  );
  await expect(check("pick-fonts", {})).rejects.toThrow(
    "workflow_http_unavailable:http_403",
  );
});

test("an execute call of designer pick-fonts with an unknown list is refused with every list and how to fix it", async () => {
  const { check } = executeCheck(fontsInUse);
  expect(
    await check("pick-fonts", {
      proposed: { primary: "Fraunces" },
      list: "handwriting",
    }),
  ).toBe(
    [
      "designer pick-fonts was not shown. One field is wrong.",
      "",
      'list: "handwriting" is not a list.',
      "  Use one of:",
      "    all      Every font. Use when the person has no preference.",
      "    sans     Clean and modern. Good for apps and dashboards.",
      "    serif    Classic and bookish. Good for long reading and editorial pages.",
      "    display  Loud and characterful. Good for headings and logos, not body text.",
      "    mono     Every letter the same width. Good for code and figures.",
      "  Or pass up to 20 font names. Or leave list out to offer every font.",
      "",
      'Your other fields were fine: proposed {"primary":"Fraunces"}.',
      "Call again with the same input and list corrected.",
    ].join("\n"),
  );
});

test("an execute call naming no installed screen is left to execute, which refuses it", async () => {
  const { check } = executeCheck(fontsInUse);
  expect(await check("pick-colors", {})).toBeUndefined();
});
