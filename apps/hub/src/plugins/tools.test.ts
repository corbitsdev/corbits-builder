import { expect, test } from "bun:test";
import { withoutResumeContext } from "../config/resume.ts";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { CATALOG } from "./catalog.ts";
import { createExecuteTools, withPluginHint } from "./tools.ts";

test("a field-matched hint names the font picker alone after the person's words and strips back to them", () => {
  const hinted = withPluginHint("fields", "the font is ugly");
  expect(hinted).toStartWith("the font is ugly\n\nBuilder's note");
  expect(hinted).toContain(
    'question({ plugin: "designer", action: "pick-fonts" })',
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

// The coordinator's question check, reading project values from a hub that answers with response.
function questionCheck(response: () => Response) {
  const asked: string[] = [];
  const fetch = async (path: string) => {
    asked.push(path);
    return response();
  };
  const capabilities = {
    resolve: () => ({ resolve: async () => ({ kind: "http", fetch }) }),
  } as unknown as RuntimeCapabilities;
  const { checkQuestion } = createExecuteTools({
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows,
    maxResultBytes: 16384,
  })({ capabilities } as never);
  if (!checkQuestion) throw new Error("the execute tools check no questions");
  return {
    asked,
    check: (action: string, input: Record<string, unknown>) =>
      checkQuestion({ plugin: "designer", action, input }),
  };
}

const fontsInUse = () =>
  Response.json({
    values: { "look.font-primary": "Inter", "look.font-secondary": null },
  });

test("a designer pick-fonts question the screen can draw is let through, checked against the project's fonts", async () => {
  const { asked, check } = questionCheck(fontsInUse);
  expect(
    await check("pick-fonts", { proposed: { primary: "Fraunces" } }),
  ).toBeUndefined();
  expect(asked).toEqual([
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

test("a designer pick-fonts question is not let through when the project's fonts cannot be read", async () => {
  const { check } = questionCheck(() =>
    Response.json({ code: "forbidden" }, { status: 403 }),
  );
  await expect(check("pick-fonts", {})).rejects.toThrow(
    "workflow_http_unavailable:http_403",
  );
});

test("a designer pick-fonts question with an unknown list is refused with every list and how to fix it", async () => {
  const { check } = questionCheck(fontsInUse);
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

test("a question for a screen the hub does not have is refused with the installed screens", async () => {
  const { check } = questionCheck(fontsInUse);
  expect(await check("pick-colors", {})).toBe(
    [
      "designer pick-colors is not an installed screen, so nothing was shown.",
      "",
      "Installed screens, as plugin and action:",
      `  designer review: ${CATALOG.screens[0]?.description}`,
      `  designer choose: ${CATALOG.screens[1]?.description}`,
      "  designer pick-fonts: Shows the person the fonts in use and fonts to choose a primary and a secondary font from.",
      "  designer pick-colours: Shows the person the primary (brand) and background colours in use and lets them choose new ones.",
      `  project hand-over: ${CATALOG.screens[4]?.description}`,
      `  writer approve: ${CATALOG.screens[5]?.description}`,
      "",
      "Call again with plugin and action set to one of them, or ask a plain question with questions instead.",
    ].join("\n"),
  );
});
