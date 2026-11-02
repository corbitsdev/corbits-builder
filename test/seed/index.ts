import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ApproachesMeta } from "@corbits-builder/schemas/approaches";
import type {
  AppBundle,
  DesignBundle as DesignBundleType,
} from "@corbits-builder/schemas/artifact";

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

export type SeedDesignOptionMetadata = Readonly<{
  conceptId: string;
  title: string;
  direction: string;
  path: string;
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
}>;

export type SeedDesignOptionFixture = Readonly<{
  conceptId: string;
  title: string;
  direction: string;
  bundle: DesignBundleType;
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
    documents: {
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
    },
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
