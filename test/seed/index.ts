import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ApproachesMeta } from "@corbits-builder/schemas/approaches";
import type {
  ExpiryPreset,
  ReviewerDecision,
  TriageItemStatus,
  WorkspaceReviewer,
} from "@corbits-builder/schemas/approval-round";
import {
  ApprovalPackageBundle,
  type AppBundle,
  type ApprovalPackageBundle as ApprovalPackageBundleType,
  type ApprovalPackageSource,
  type DesignBundle as DesignBundleType,
} from "@corbits-builder/schemas/artifact";
import { base64Encode } from "@intx/types";
import {
  checkDeck,
  validateDeck,
  writeDeckPdf,
  writePptx,
} from "@corbits/slidedeck";

export const SEED_STAGES = [
  "idea",
  "brief",
  "planning",
  "design_options",
  "designed",
  "ready_to_build",
  "shipped",
] as const;

export type SeedStage = (typeof SEED_STAGES)[number];

export const SEED_FIXTURE_IDS = [
  "habit-tracker",
  "field-service-dispatch",
  "clinical-trial-intake",
] as const;

export type SeedFixtureId = (typeof SEED_FIXTURE_IDS)[number];

export type SeedFixtureSelector = SeedFixtureId | "all";

export const SEED_WORKSPACE_REVIEWERS: readonly WorkspaceReviewer[] = [
  {
    id: "ws-rev-dana-chen",
    name: "Dana Chen",
    persona: "CEO",
    email: "dana.chen@example.com",
    goal: "Approve Aurora Weather Studio scope, timeline, and Q3 budget to begin the Coder phase",
  },
  {
    id: "ws-rev-marcus-vance",
    name: "Marcus Vance",
    persona: "CTO",
    email: "marcus.vance@example.com",
    goal: "Sign off on radar tile payload budget, latency SLAs, and offline caching architecture",
  },
  {
    id: "ws-rev-priya-patel",
    name: "Priya Patel",
    persona: "VP Product",
    email: "priya.patel@example.com",
    goal: "Confirm user journey, severe alert triage flow, and accessibility targets",
  },
];

export type SeedDesignOptionMetadata = Readonly<{
  conceptId: string;
  title: string;
  direction: string;
  path: string;
}>;

export type SeedApprovalPackageMetadata = Readonly<{
  title: string;
  audience: string;
  decisionNeeded: string;
  tone: string;
  length: string;
  deckPath: string;
}>;

export type SeedApprovalReviewerMetadata = Readonly<{
  id: string;
  name: string;
  persona: string;
  email?: string;
  goal?: string;
  decision?: ReviewerDecision;
}>;

export type SeedApprovalTriageMetadata = Readonly<{
  itemId: string;
  reviewerId: string;
  reviewerName: string;
  persona: string;
  slide?: number;
  text: string;
  status: TriageItemStatus;
  reply?: string;
}>;

export type SeedApprovalRoundMetadata = Readonly<{
  expiry: ExpiryPreset;
  reviewers: readonly SeedApprovalReviewerMetadata[];
  triage: readonly SeedApprovalTriageMetadata[];
}>;

export type SeedProjectMetadata = Readonly<{
  slug: SeedFixtureId;
  id: SeedFixtureId;
  title: string;
  complexity: "simple" | "medium" | "complex";
  defaultStage: SeedStage;
  idea: string;
  problemStatement: string;
  chosenConceptId: string;
  chosenDesignOption: string;
  documents: Readonly<{
    problem_brief: Readonly<{ title: string; path: string }>;
    constraints: Readonly<{ title: string; path: string }>;
    approaches: Readonly<{
      title: string;
      path: string;
      approaches: ApproachesMeta;
    }>;
    product_requirements: Readonly<{ title: string; path: string }>;
    design: Readonly<{ title: string; path: string }>;
    build_plan: Readonly<{ title: string; path: string }>;
  }>;
  designOptions: readonly [SeedDesignOptionMetadata, SeedDesignOptionMetadata];
  app: Readonly<{ path: string }>;
  approvalPackage?: SeedApprovalPackageMetadata;
  approvalRound?: SeedApprovalRoundMetadata;
}>;

export type SeedDesignOptionFixture = Readonly<{
  conceptId: string;
  title: string;
  direction: string;
  bundle: DesignBundleType;
}>;

export type SeedApprovalPackageFixture = Readonly<{
  title: string;
  bundle: ApprovalPackageBundleType;
}>;

export type SeedProjectFixture = Readonly<{
  id: SeedFixtureId;
  slug: SeedFixtureId;
  title: string;
  complexity: "simple" | "medium" | "complex";
  defaultStage: SeedStage;
  idea: string;
  problemStatement: string;
  chosenConceptId: string;
  chosenDesignOption: string;
  documents: Readonly<{
    problem_brief: Readonly<{ title: string; content: string }>;
    constraints: Readonly<{ title: string; content: string }>;
    approaches: Readonly<{
      title: string;
      content: string;
      approaches: ApproachesMeta;
    }>;
    product_requirements: Readonly<{ title: string; content: string }>;
    design: Readonly<{ title: string; content: string }>;
    build_plan: Readonly<{ title: string; content: string }>;
  }>;
  designOptions: readonly [SeedDesignOptionFixture, SeedDesignOptionFixture];
  app: AppBundle;
  approvalPackage?: SeedApprovalPackageFixture;
  approvalRound?: SeedApprovalRoundMetadata;
}>;

export const DEFAULT_SEED_ROOT = resolve(import.meta.dir);

async function readDirectoryFiles(
  rootDir: string,
  currentDir = rootDir,
): Promise<Record<string, string>> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const sorted = [...entries].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files: Record<string, string> = {};
  for (const entry of sorted) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await readDirectoryFiles(rootDir, fullPath);
      for (const [nestedKey, nestedValue] of Object.entries(nested)) {
        files[nestedKey] = nestedValue;
      }
    } else if (entry.isFile()) {
      const relPath = relative(rootDir, fullPath).replaceAll("\\", "/");
      files[relPath] = await readFile(fullPath, "utf8");
    }
  }
  return files;
}

async function loadDesignOptionBundle(
  projectDir: string,
  optionMeta: SeedDesignOptionMetadata,
): Promise<DesignBundleType> {
  const optionDir = resolve(projectDir, optionMeta.path);
  const rawFiles = await readDirectoryFiles(optionDir);
  const designMd = rawFiles["DESIGN.md"];
  const stylesCss = rawFiles["styles.css"];
  const indexHtml = rawFiles["index.html"];
  if (!designMd || !stylesCss || !indexHtml) {
    throw new Error(
      `Design option ${optionMeta.conceptId} in ${projectDir} is missing DESIGN.md, styles.css, or index.html`,
    );
  }

  const bundleFiles: Record<string, string> = {
    "DESIGN.md": designMd,
    "designs/styles.css": stylesCss,
    "designs/index.html": indexHtml,
  };

  for (const [relPath, content] of Object.entries(rawFiles)) {
    if (
      relPath !== "DESIGN.md" &&
      relPath !== "styles.css" &&
      relPath !== "index.html"
    ) {
      bundleFiles[`designs/${relPath}`] = content;
    }
  }

  return { files: bundleFiles };
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function loadApprovalPackageFixture(
  projectDir: string,
  metadata: SeedProjectMetadata,
  pkgMeta: SeedApprovalPackageMetadata,
  docs: SeedProjectFixture["documents"],
): Promise<SeedApprovalPackageFixture> {
  const deckRaw = await readFile(resolve(projectDir, pkgMeta.deckPath), "utf8");
  const validated = validateDeck(JSON.parse(deckRaw));
  if (!validated.ok) {
    throw new Error(
      `Invalid seed slide deck in ${projectDir}: ${JSON.stringify(validated.issues)}`,
    );
  }
  const issues = checkDeck(validated.deck, new Map());
  if (issues.length > 0) {
    throw new Error(
      `Seed slide deck check failed in ${projectDir}: ${JSON.stringify(issues)}`,
    );
  }
  const pptxBytes = await writePptx(validated.deck, new Map());
  const pdfBytes = writeDeckPdf(validated.deck, new Map());

  const defaultSources: ApprovalPackageSource[] = [
    {
      artifactId: `seed-${metadata.id}-problem_brief`,
      kind: "problem_brief",
      title: docs.problem_brief.title,
      version: 1,
      sha256: sha256Hex(docs.problem_brief.content),
    },
    {
      artifactId: `seed-${metadata.id}-constraints`,
      kind: "constraints",
      title: docs.constraints.title,
      version: 1,
      sha256: sha256Hex(docs.constraints.content),
    },
    {
      artifactId: `seed-${metadata.id}-approaches`,
      kind: "approaches",
      title: docs.approaches.title,
      version: 1,
      sha256: sha256Hex(docs.approaches.content),
    },
    {
      artifactId: `seed-${metadata.id}-product_requirements`,
      kind: "product_requirements",
      title: docs.product_requirements.title,
      version: 1,
      sha256: sha256Hex(docs.product_requirements.content),
    },
    {
      artifactId: `seed-${metadata.id}-design`,
      kind: "design",
      title: docs.design.title,
      version: 1,
      sha256: sha256Hex(docs.design.content),
    },
    {
      artifactId: `seed-${metadata.id}-build_plan`,
      kind: "build_plan",
      title: docs.build_plan.title,
      version: 1,
      sha256: sha256Hex(docs.build_plan.content),
    },
  ];

  const bundle = ApprovalPackageBundle.assert({
    manifest: {
      audience: pkgMeta.audience,
      decisionNeeded: pkgMeta.decisionNeeded,
      tone: pkgMeta.tone,
      length: pkgMeta.length,
      sources: defaultSources,
    },
    deck: validated.deck as unknown as Record<string, unknown>,
    pptxBase64: base64Encode(pptxBytes),
    pdfBase64: base64Encode(pdfBytes),
    documents: {
      problem_brief: docs.problem_brief.content,
      constraints: docs.constraints.content,
      approaches: docs.approaches.content,
      product_requirements: docs.product_requirements.content,
      design: docs.design.content,
      build_plan: docs.build_plan.content,
    },
  });

  return {
    title: pkgMeta.title,
    bundle,
  };
}

export async function loadSeedProjectFixture(
  id: SeedFixtureId,
  seedRootDir: string = DEFAULT_SEED_ROOT,
): Promise<SeedProjectFixture> {
  const projectDir = resolve(seedRootDir, id);
  const metadataRaw = await readFile(join(projectDir, "project.json"), "utf8");
  const metadata = JSON.parse(metadataRaw) as SeedProjectMetadata;

  const [
    problemBriefContent,
    constraintsContent,
    approachesContent,
    productRequirementsContent,
    designContent,
    buildPlanContent,
    firstOptionBundle,
    secondOptionBundle,
    appFiles,
  ] = await Promise.all([
    readFile(
      resolve(projectDir, metadata.documents.problem_brief.path),
      "utf8",
    ),
    readFile(resolve(projectDir, metadata.documents.constraints.path), "utf8"),
    readFile(resolve(projectDir, metadata.documents.approaches.path), "utf8"),
    readFile(
      resolve(projectDir, metadata.documents.product_requirements.path),
      "utf8",
    ),
    readFile(resolve(projectDir, metadata.documents.design.path), "utf8"),
    readFile(resolve(projectDir, metadata.documents.build_plan.path), "utf8"),
    loadDesignOptionBundle(projectDir, metadata.designOptions[0]),
    loadDesignOptionBundle(projectDir, metadata.designOptions[1]),
    readDirectoryFiles(resolve(projectDir, metadata.app.path)),
  ]);

  const documents: SeedProjectFixture["documents"] = {
    problem_brief: {
      title: metadata.documents.problem_brief.title,
      content: problemBriefContent,
    },
    constraints: {
      title: metadata.documents.constraints.title,
      content: constraintsContent,
    },
    approaches: {
      title: metadata.documents.approaches.title,
      content: approachesContent,
      approaches: metadata.documents.approaches.approaches,
    },
    product_requirements: {
      title: metadata.documents.product_requirements.title,
      content: productRequirementsContent,
    },
    design: {
      title: metadata.documents.design.title,
      content: designContent,
    },
    build_plan: {
      title: metadata.documents.build_plan.title,
      content: buildPlanContent,
    },
  };

  const approvalPackage =
    metadata.approvalPackage === undefined
      ? undefined
      : await loadApprovalPackageFixture(
          projectDir,
          metadata,
          metadata.approvalPackage,
          documents,
        );

  return {
    id: metadata.id,
    slug: metadata.slug,
    title: metadata.title,
    complexity: metadata.complexity,
    defaultStage: metadata.defaultStage,
    idea: metadata.idea,
    problemStatement: metadata.problemStatement,
    chosenConceptId: metadata.chosenConceptId,
    chosenDesignOption: metadata.chosenDesignOption,
    documents,
    designOptions: [
      {
        conceptId: metadata.designOptions[0].conceptId,
        title: metadata.designOptions[0].title,
        direction: metadata.designOptions[0].direction,
        bundle: firstOptionBundle,
      },
      {
        conceptId: metadata.designOptions[1].conceptId,
        title: metadata.designOptions[1].title,
        direction: metadata.designOptions[1].direction,
        bundle: secondOptionBundle,
      },
    ],
    app: {
      files: appFiles,
    },
    ...(approvalPackage === undefined ? {} : { approvalPackage }),
    ...(metadata.approvalRound === undefined
      ? {}
      : { approvalRound: metadata.approvalRound }),
  };
}

export async function loadSeedProjectFixtures(
  selector: SeedFixtureSelector = "all",
  seedRootDir: string = DEFAULT_SEED_ROOT,
): Promise<readonly SeedProjectFixture[]> {
  const ids: readonly SeedFixtureId[] =
    selector === "all" ? SEED_FIXTURE_IDS : [selector];
  return Promise.all(
    ids.map((fixtureId) => loadSeedProjectFixture(fixtureId, seedRootDir)),
  );
}

export const SEED_PROJECT_FIXTURES: readonly SeedProjectFixture[] =
  await loadSeedProjectFixtures("all");

export function getSeedProjectFixture(id: SeedFixtureId): SeedProjectFixture {
  const fixture = SEED_PROJECT_FIXTURES.find((entry) => entry.id === id);
  if (!fixture) {
    throw new Error(`Unknown seed fixture: ${id}`);
  }
  return fixture;
}

export function resolveSeedFixtures(
  selector: SeedFixtureSelector,
): readonly SeedProjectFixture[] {
  if (selector === "all") {
    return SEED_PROJECT_FIXTURES;
  }
  return [getSeedProjectFixture(selector)];
}
