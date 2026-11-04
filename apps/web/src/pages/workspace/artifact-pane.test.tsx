import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectArtifact } from "@corbits-builder/client";
import {
  ArtifactPane,
  LIVE_TAB,
  availableTab,
  defaultTab,
  resolveSelection,
} from "./artifact-pane.tsx";
import { APPROVAL_PACKAGE_MEDIA_TYPE } from "./approval-package-preview.tsx";
import type { DeliverableState } from "./deliverable-block.tsx";
import { writeWorkspaceApprovalsEnabled } from "../../workspace-approvals-setting.ts";

type Deliverable = ProjectArtifact;
const ready: Deliverable = {
  artifactId: "brief",
  kind: "problem_brief",
  title: "Problem brief",
  version: 2,
  sha256: "a".repeat(64),
};
const document: DeliverableState = {
  status: "ready",
  document: {
    title: "Problem brief",
    mediaType: "text/markdown",
    content: "# Real output\nUpdated content",
    filedAt: "2026-10-30T12:00:00.000Z",
    version: 2,
    sha256: "a".repeat(64),
    before: {
      version: 1,
      content: "Previous content",
      filedAt: "2026-10-30T11:00:00.000Z",
    },
    versions: [],
  },
};
function render(
  selected: Deliverable | null,
  state?: DeliverableState,
  changesOpen = false,
) {
  return renderToStaticMarkup(
    <ArtifactPane
      projectTitle="Project"
      deliverables={selected ? [selected] : []}
      selected={selected}
      state={state}
      changesOpen={changesOpen}
      onSelect={() => {}}
      onToggleChanges={() => {}}
    />,
  );
}

describe("persistent artifact pane", () => {
  test("exists before artifacts without modal or Expand controls", () => {
    const html = render(null);
    expect(html).toContain('aria-label="Artifacts"');
    expect(html).toContain("Your outputs appear here");
    expect(html).not.toContain(">Artifacts<");
    expect(html).not.toContain(">Output<");
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("inert");
    expect(html).not.toContain("Expand");
  });
  test("renders real content immediately with selection and available changes", () => {
    const html = render(ready, document, true);
    expect(html).toContain("Real output");
    expect(html).toContain("Updated content");
    expect(html).toContain("Comparing v1 → v2");
    expect(html).toContain("Previous content");
    expect(html).toContain("v1 → v2");
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain("<select");
  });
  test("shows the document title once and hides a single retained version", () => {
    if (document.status !== "ready") throw new Error("invalid fixture");
    const title = "Weather App First-Version Problem Brief";
    const html = render(
      { ...ready, title },
      {
        status: "ready",
        document: {
          ...document.document,
          title,
          version: 1,
          content: `# ${title}\n\nThe forecast for the weekend.`,
          versions: [
            {
              version: 1,
              title,
              mediaType: "text/markdown",
            },
          ],
        },
      },
    );
    expect(html).toContain('role="tab"');
    expect(html.split(`>${title}<`).length - 1).toBe(1);
    expect(html).toContain("The forecast for the weekend.");
    expect(html).not.toContain(">Artifacts<");
    expect(html).not.toContain(">Output<");
    expect(html).not.toContain("only retained version");
    expect(html).not.toContain("<select");
  });
  test("renders HTML as a sandboxed design preview", () => {
    if (document.status !== "ready") throw new Error("invalid fixture");
    const html = render(ready, {
      status: "ready",
      document: {
        ...document.document,
        mediaType: "text/html",
        content: "<h1>Actual design</h1>",
      },
    });
    expect(html).toContain('title="Design"');
    expect(html).toContain('sandbox=""');
    expect(html).toContain('srcDoc="&lt;h1&gt;Actual design&lt;/h1&gt;"');
  });
  test("shows compact loading and read errors", () => {
    expect(render(ready, { status: "loading" })).toContain(
      "Reading the document…",
    );
    expect(
      render(ready, {
        status: "error",
        message: "Retained content unavailable",
        retryable: true,
      }),
    ).toContain("Retained content unavailable");
  });
  test("renders approval_package deliverable with Approval tab, reminder note, and slides view, and hides it when approvals are disabled", () => {
    if (document.status !== "ready") throw new Error("invalid fixture");
    writeWorkspaceApprovalsEnabled("on");
    const pkgDeliverable: Deliverable = {
      artifactId: "pkg-1",
      kind: "approval_package",
      title: "Executive Sign-off Package",
      version: 1,
      sha256: "b".repeat(64),
    };
    const bundleContent = JSON.stringify({
      manifest: {
        audience: "Board",
        decisionNeeded: "Approve launch",
        tone: "Concise",
        length: "3 slides",
        sources: [
          {
            artifactId: "11111111-1111-4111-8111-111111111111",
            kind: "problem_brief",
            title: "Problem brief",
            version: 2,
            sha256: "a".repeat(64),
          },
        ],
      },
      deck: {
        slides: [
          {
            layout: "title",
            title: "Launch Readiness",
            subtitle: "Summary of approved scope",
          },
        ],
      },
      pptxBase64: Buffer.from("pptx").toString("base64"),
      pdfBase64: Buffer.from("pdf").toString("base64"),
    });
    const html = render(pkgDeliverable, {
      status: "ready",
      document: {
        ...document.document,
        title: "Executive Sign-off Package",
        mediaType: APPROVAL_PACKAGE_MEDIA_TYPE,
        version: 1,
        content: bundleContent,
      },
    });
    expect(html).toContain(">Approval<");
    expect(html).not.toContain(">Approval package<");
    expect(html).not.toContain(">Executive Sign-off Package</h1>");
    expect(html).toContain("Add new reviewer");
    expect(html).not.toContain("Add reviewers &amp; download .zip");
    expect(html).toContain("Launch Readiness");
    expect(html).toContain("Summary of approved scope");

    writeWorkspaceApprovalsEnabled("off");
    const bypassedHtml = renderToStaticMarkup(
      <ArtifactPane
        projectTitle="Project"
        deliverables={[ready, pkgDeliverable]}
        selected={ready}
        state={document}
        changesOpen={false}
        onSelect={() => {}}
        onToggleChanges={() => {}}
      />,
    );
    expect(bypassedHtml).not.toContain(">Approval<");
    writeWorkspaceApprovalsEnabled("on");
  });
});

describe("default tab", () => {
  const plan: Deliverable = {
    artifactId: "plan",
    kind: "build_plan",
    title: "Build plan",
    version: 1,
    sha256: "b".repeat(64),
  };
  test("nothing chosen shows the live app once the build has started", () => {
    expect(defaultTab(true, [ready, plan])).toBe(LIVE_TAB);
  });
  test("before the build it shows the document furthest along, and nothing before any", () => {
    expect(defaultTab(false, [ready, plan])).toBe("build_plan");
    expect(defaultTab(false, [])).toBeNull();
  });
});

describe("remembered tab", () => {
  const plan: Deliverable = {
    artifactId: "plan",
    kind: "build_plan",
    title: "Build plan",
    version: 1,
    sha256: "b".repeat(64),
  };
  const have = {
    liveApp: false,
    manual: false,
    themes: false,
    draft: false,
    concepts: [] as string[],
    deliverables: [ready, plan],
  };
  test("a remembered tab counts only while the pane can show it", () => {
    expect(availableTab("build_plan", have)).toBe("build_plan");
    expect(availableTab("design-mockup", have)).toBeNull();
    expect(availableTab(LIVE_TAB, have)).toBeNull();
    expect(availableTab(LIVE_TAB, { ...have, liveApp: true })).toBe(LIVE_TAB);
    expect(availableTab("user-manual", { ...have, manual: true })).toBe(
      "user-manual",
    );
    expect(availableTab(null, have)).toBeNull();
  });
  test("with nothing chosen yet, the remembered document opens instead of the default", () => {
    expect(resolveSelection(null, true, [ready, plan], ready.kind)).toEqual({
      selectedId: null,
      documentToOpen: ready.kind,
    });
    // A remembered side tab is the pane's own to restore; the default stands meanwhile.
    expect(resolveSelection(null, true, [ready, plan], LIVE_TAB)).toEqual({
      selectedId: LIVE_TAB,
      documentToOpen: null,
    });
    // One that is not filed here falls back to the default.
    expect(resolveSelection(null, false, [ready, plan], "design")).toEqual({
      selectedId: null,
      documentToOpen: "build_plan",
    });
    // The person's own choice always wins.
    expect(
      resolveSelection("build_plan", true, [ready, plan], ready.kind),
    ).toEqual({ selectedId: "build_plan", documentToOpen: null });
  });
});
