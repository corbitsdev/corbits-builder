import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApprovalPackageBundle } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import {
  APPROVAL_PACKAGE_MEDIA_TYPE,
  ApprovalPackagePreview,
  approvalPackagePdfFile,
  parseApprovalPackage,
} from "./approval-package-preview.tsx";

const sampleBundle: ApprovalPackageBundle = {
  manifest: {
    audience: "Executive steering committee",
    decisionNeeded: "Approve Phase 1 rollout",
    tone: "Executive",
    length: "5 slides",
    sources: [
      {
        artifactId: "11111111-1111-4111-8111-111111111111",
        kind: "problem_brief",
        title: "Customer Portal Brief",
        version: 2,
        sha256: "abcdef0123456789".repeat(4),
      },
      {
        artifactId: "22222222-2222-4222-8222-222222222222",
        kind: "product_requirements",
        title: "Portal Requirements",
        version: 1,
        sha256: "9876543210fedcba".repeat(4),
      },
    ],
  },
  deck: {
    theme: {
      colors: {
        primary: "#1e293b",
        secondary: "#334155",
        accent: "#2563eb",
        background: "#ffffff",
        text: "#0f172a",
        muted: "#64748b",
      },
      fonts: {
        heading: "Inter",
        body: "Inter",
      },
    },
    slides: [
      {
        layout: "title",
        title: "Customer Portal Approval Package",
        subtitle: "Phase 1 scope and rollout plan",
        notes: "Welcome the steering committee.",
      },
      {
        layout: "comparison",
        title: "Option Trade-offs",
        left: {
          heading: "Phased Rollout",
          body: [
            {
              type: "list",
              items: [
                "Lower risk",
                [{ text: "Faster", bold: true }, " initial launch"],
              ],
            },
          ],
        },
        right: {
          heading: "Big Bang",
          body: [{ type: "paragraph", text: "Single cutover across regions." }],
        },
      },
    ],
  },
  pptxBase64: Buffer.from("fake-pptx").toString("base64"),
  pdfBase64: Buffer.from("%PDF-1.4 fake-pdf").toString("base64"),
  documents: {
    "executive-summary.md": "# Executive Summary\n\nReady for Phase 1.",
  },
};

describe("approval package preview", () => {
  test("parses valid approval_package JSON and rejects malformed payloads", () => {
    const parsed = parseApprovalPackage(JSON.stringify(sampleBundle));
    expect(parsed).not.toBeNull();
    expect(parsed?.manifest.audience).toBe("Executive steering committee");
    expect(parseApprovalPackage("{not-json")).toBeNull();
    expect(parseApprovalPackage(JSON.stringify({ manifest: {} }))).toBeNull();

    const pdfFile = approvalPackagePdfFile("portal-package-v1", sampleBundle);
    expect(pdfFile?.name).toBe("portal-package-v1.pdf");
    expect(pdfFile?.type).toBe("application/pdf");
    expect(APPROVAL_PACKAGE_MEDIA_TYPE).toContain("approval-package+json");
  });

  test("renders slides view with theme colors, comparison columns, and speaker notes", () => {
    const html = renderToStaticMarkup(
      <ApprovalPackagePreview
        content={JSON.stringify(sampleBundle)}
        stem="portal-package-v1"
        initialTab="slides"
      />,
    );
    expect(html).toContain("Slides");
    expect(html).toContain("PDF");
    expect(html).toContain("Sources");
    expect(html).toContain("Slide 1 of 2");
    expect(html).toContain("Customer Portal Approval Package");
    expect(html).toContain("Phase 1 scope and rollout plan");
    expect(html).toContain("Option Trade-offs");
    expect(html).toContain("Phased Rollout");
    expect(html).toContain("Lower risk");
    expect(html).toContain("Single cutover across regions.");
    expect(html).toContain("#1e293b");
  });

  test("renders PDF view with print-accurate page sheets and download link without blocked data: iframe", () => {
    const html = renderToStaticMarkup(
      <ApprovalPackagePreview
        content={JSON.stringify(sampleBundle)}
        stem="portal-package-v1"
        initialTab="pdf"
      />,
    );
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Approval package PDF preview");
    expect(html).toContain("portal-package-v1.pdf");
    expect(html).toContain("Download PDF");
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain("Page 2 of 2");
    expect(html).toContain("Customer Portal Approval Package");
  });

  test("a PDF whose base64 does not decode offers no download and says it could not be read", () => {
    const html = renderToStaticMarkup(
      <ApprovalPackagePreview
        content={JSON.stringify({ ...sampleBundle, pdfBase64: "not base64!" })}
        stem="portal-package-v1"
        initialTab="pdf"
      />,
    );
    expect(html).toContain(wording.approvalPackage.pdfUnreadable);
    expect(html).not.toContain(wording.approvalPackage.downloadPdf);
    expect(html).toContain("Page 1 of 2");
  });

  test("enforces high-contrast text on dark-background slide decks", () => {
    const darkDeckBundle: ApprovalPackageBundle = {
      ...sampleBundle,
      deck: {
        theme: {
          colors: {
            primary: "#0369a1",
            secondary: "#0369a1",
            accent: "#0ea5e9",
            background: "#0a1120",
            text: "#f8fafc",
            muted: "#64748b",
          },
        },
        slides: [
          {
            layout: "title",
            title: "Aurora Weather Executive Package",
            subtitle: "Phase 1 architecture and launch readiness",
            notes: "Highlight sub-second radar tile caching.",
          },
        ],
      },
    };
    const html = renderToStaticMarkup(
      <ApprovalPackagePreview
        content={JSON.stringify(darkDeckBundle)}
        stem="aurora-package-v1"
        initialTab="slides"
      />,
    );
    expect(html).toContain('data-slide-tone="dark"');
    expect(html).toContain("color:#f8fafc");
    expect(html).toContain("color:#cbd5e1");
    expect(html).not.toContain("color:#0369a1");
  });

  test("renders Sources view with manifest metadata, clickable pinned source documents table and supporting markdown", () => {
    const html = renderToStaticMarkup(
      <ApprovalPackagePreview
        content={JSON.stringify(sampleBundle)}
        stem="portal-package-v1"
        initialTab="sources"
      />,
    );
    expect(html).toContain("Executive steering committee");
    expect(html).toContain("Approve Phase 1 rollout");
    expect(html).toContain("Executive");
    expect(html).toContain("5 slides");
    expect(html).toContain("Customer Portal Brief");
    expect(html).toContain("Portal Requirements");
    expect(html).toContain("approval-package-source-link");
    expect(html).toContain("v2");
    expect(html).toContain("abcdef012345");
    expect(html).toContain("executive-summary.md");
    expect(html).toContain("Ready for Phase 1.");
  });
});
