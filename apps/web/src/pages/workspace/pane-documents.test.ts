import { describe, expect, test } from "bun:test";
import type { ProjectArtifact } from "@corbits-builder/client";
import { wording } from "../../config.ts";
import { paneDocumentKey, roomDocumentKey } from "./load-room.ts";
import {
  paneArtifacts,
  paneDocument,
  shownDocument,
  tabbedArtifacts,
} from "./pane-documents.ts";

const filed = (kind: string, artifactId = kind): ProjectArtifact => ({
  artifactId,
  kind,
  title: kind,
  version: 1,
  sha256: "a".repeat(64),
  filedAt: "2026-10-30T12:00:00.000Z",
});

describe("the pane's documents", () => {
  test("the app's source is no document, and each material is a tab of its own", () => {
    const panes = paneArtifacts([
      filed("problem_brief"),
      filed("app"),
      filed("material", "sketch"),
      filed("material", "brand-guide"),
    ]);
    expect(panes.map((item) => item.kind)).toEqual([
      "problem_brief",
      "material:sketch",
      "material:brand-guide",
    ]);
  });

  test("a material's tab reads the document loaded for the material it was filed as", () => {
    const material = filed("material", "sketch");
    const [tab] = paneArtifacts([material]);
    if (tab === undefined) throw new Error("no tab");
    expect(paneDocumentKey("project-1", tab)).toBe(
      roomDocumentKey("project-1", material),
    );
  });

  test("an approval package is a document only while stakeholder approvals are on", () => {
    const artifacts = [filed("problem_brief"), filed("approval_package")];
    const kinds = (approvals: "on" | "off") =>
      tabbedArtifacts(artifacts, approvals).map((item) => item.kind);
    expect(kinds("on")).toEqual(["problem_brief", "approval_package"]);
    expect(kinds("off")).toEqual(["problem_brief"]);
  });

  test("a concept's option is never an ordinary document tab", () => {
    const kinds = tabbedArtifacts(
      [filed("design"), filed("design_option", "option-1")],
      "on",
    ).map((item) => item.kind);
    expect(kinds).toEqual(["design"]);
  });
});

test("a document revised after the person approved it is shown at its newest version, with no approval of an older one named", () => {
  const revised = paneDocument(
    {
      artifactId: "44444444-4444-4444-8444-444444444444",
      kind: "product_requirements",
      title: "Product requirements",
      version: 2,
      sha256: "0".repeat(64),
      filedAt: new Date(20).toISOString(),
      approvedVersion: 1,
    },
    { "44444444-4444-4444-8444-444444444444": 1 },
  );
  expect(revised.status).toBe(wording.documentStatus.approved(2));
  expect(revised.status).not.toContain("v1");
  // The viewer read v1; v2 is new to them, so the tab opens on it unread.
  expect(revised.unread).toBe(true);
});

describe("a document as an approval lists it", () => {
  const brief = filed("problem_brief");
  const loaded = (mediaType: string, content: string) =>
    ({
      status: "ready",
      document: {
        ...brief,
        mediaType,
        content,
        before: null,
        versions: [],
      },
    }) as const;

  test("a written document carries its In short section once its body has loaded", () => {
    const body =
      "# Problem brief\n\n## In short\n\nA weather app for cyclists.\n\n## Detail\n\nMore.";
    expect(
      shownDocument(brief, loaded("text/markdown", body)).summary,
    ).toContain("A weather app for cyclists.");
  });

  test("before its body loads, or when it is not written text, it carries no summary", () => {
    expect(shownDocument(brief, undefined)).toBe(brief);
    expect(shownDocument(brief, { status: "loading" })).toBe(brief);
    expect(shownDocument(brief, loaded("application/json", "{}"))).toBe(brief);
  });
});
