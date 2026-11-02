import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AppBundle,
  DesignBundle,
  DocumentWrite,
  type ArtifactList,
  type ArtifactListItem,
  type ArtifactRef,
} from "@corbits-builder/schemas/artifact";
import {
  DEFAULT_SEED_ROOT,
  SEED_FIXTURE_IDS,
  SEED_PROJECT_FIXTURES,
  SEED_STAGES,
  loadSeedProjectFixture,
  loadSeedProjectFixtures,
} from "../seed/index.ts";
import {
  parseSeedCliArgs,
  seedDevelopmentProjects,
  seedUsageText,
  type SeedDeps,
} from "../../scripts/seed-projects.ts";

function createInMemorySeedDeps(): SeedDeps {
  const projects = new Map<
    string,
    {
      title: string;
      problemStatement: string;
      shippedAt: string | null;
      artifacts: Map<
        string,
        {
          artifactId: string;
          kind: string;
          title: string;
          content: string;
          version: number;
          sha256: string;
          approved: boolean;
        }
      >;
    }
  >();

  let counter = 0;
  function nextSha(): string {
    counter += 1;
    return counter.toString(16).padStart(64, "0");
  }

  return {
    async resolveWorkspaceTenant(tenantId?: string) {
      return {
        tenantId: tenantId ?? "tenant-workspace-default",
        principalId: "principal-workspace-owner",
        userId: "user-dev-1",
      };
    },

    async createProject(workspace, input) {
      const projectId = `project-${input.fixtureId}`;
      projects.set(projectId, {
        title: input.title,
        problemStatement: input.problemStatement,
        shippedAt: null,
        artifacts: new Map(),
      });
      return {
        projectId,
        actor: {
          tenantId: `tenant-${input.fixtureId}`,
          principalId: `principal-${input.fixtureId}`,
          userId: workspace.userId,
          parentTenantId: workspace.tenantId,
        },
      };
    },

    async writeArtifact(_actor, projectId, input) {
      const state = projects.get(projectId);
      if (!state) {
        throw new Error(`Missing project ${projectId}`);
      }
      const key =
        input.kind === "design_option"
          ? `${input.kind}:${input.title}`
          : input.kind;
      const artifactId = `artifact-${projectId}-${key}`;
      const ref: ArtifactRef = {
        artifactId,
        kind: input.kind,
        version: 1,
        sha256: nextSha(),
      };
      state.artifacts.set(key, {
        ...ref,
        title: input.title,
        content: input.content,
        approved: false,
      });
      return ref;
    },

    async recordArtifactApproval(_actor, projectId, ref) {
      const state = projects.get(projectId);
      if (!state) {
        throw new Error(`Missing project ${projectId}`);
      }
      for (const entry of state.artifacts.values()) {
        if (entry.artifactId === ref.artifactId) {
          entry.approved = true;
        }
      }
    },

    async chooseDesign(_actor, projectId, input) {
      const state = projects.get(projectId);
      if (!state) {
        throw new Error(`Missing project ${projectId}`);
      }
      const chosen = [...state.artifacts.values()].find(
        (entry) => entry.artifactId === input.artifactId,
      );
      if (!chosen) {
        throw new Error(`Design option ${input.artifactId} not found`);
      }
      const designRef: ArtifactRef = {
        artifactId: `artifact-${projectId}-design`,
        kind: "design",
        version: 1,
        sha256: nextSha(),
      };
      state.artifacts.set("design", {
        ...designRef,
        title: chosen.title,
        content: chosen.content,
        approved: true,
      });
      return {
        concept: chosen.title,
        design: designRef,
      };
    },

    async shipProject(_actor, projectId) {
      const state = projects.get(projectId);
      if (!state) {
        throw new Error(`Missing project ${projectId}`);
      }
      const shippedAt = "2026-11-01T12:00:00.000Z";
      state.shippedAt = shippedAt;
      return { ok: true, projectId, shippedAt };
    },

    async listArtifacts(_actor, projectId): Promise<ArtifactList> {
      const state = projects.get(projectId);
      if (!state) {
        throw new Error(`Missing project ${projectId}`);
      }
      const items: ArtifactListItem[] = [];
      const awaitingApproval: string[] = [];
      for (const entry of state.artifacts.values()) {
        items.push({
          artifactId: entry.artifactId,
          kind: entry.kind,
          title: entry.title,
          version: entry.version,
          sha256: entry.sha256,
          filedAt: "2026-11-01T12:00:00.000Z",
          ...(entry.approved ? { approvedVersion: entry.version } : {}),
        });
        if (
          !entry.approved &&
          entry.kind !== "design_option" &&
          entry.kind !== "design" &&
          entry.kind !== "app"
        ) {
          awaitingApproval.push(entry.kind);
        }
      }
      return {
        artifacts: items,
        inFlight: [],
        failed: [],
        awaitingApproval,
        preferences: {},
        preferenceGuidance: [],
      };
    },
  };
}

describe("test/seed fixtures on disk", () => {
  test("loads all 3 seed project fixtures from real files under test/seed/<slug>/", async () => {
    const loaded = await loadSeedProjectFixtures("all");
    expect(loaded).toHaveLength(3);
    expect(loaded.map((item) => item.id)).toEqual([...SEED_FIXTURE_IDS]);

    for (const fixtureId of SEED_FIXTURE_IDS) {
      const dir = join(DEFAULT_SEED_ROOT, fixtureId);
      expect(existsSync(join(dir, "project.json"))).toBe(true);
      expect(existsSync(join(dir, "docs", "problem_brief.md"))).toBe(true);
      expect(existsSync(join(dir, "docs", "constraints.md"))).toBe(true);
      expect(existsSync(join(dir, "docs", "approaches.md"))).toBe(true);
      expect(existsSync(join(dir, "docs", "product_requirements.md"))).toBe(
        true,
      );
      expect(existsSync(join(dir, "docs", "design.md"))).toBe(true);
      expect(existsSync(join(dir, "docs", "build_plan.md"))).toBe(true);
      expect(existsSync(join(dir, "app", "package.json"))).toBe(true);
      expect(existsSync(join(dir, "app", "src", "App.tsx"))).toBe(true);

      const fixture = await loadSeedProjectFixture(fixtureId);
      DocumentWrite.assert({
        kind: "problem_brief",
        title: fixture.documents.problem_brief.title,
        content: fixture.documents.problem_brief.content,
      });
      DocumentWrite.assert({
        kind: "constraints",
        title: fixture.documents.constraints.title,
        content: fixture.documents.constraints.content,
      });
      DocumentWrite.assert({
        kind: "approaches",
        title: fixture.documents.approaches.title,
        content: fixture.documents.approaches.content,
        approaches: fixture.documents.approaches.approaches,
      });
      DocumentWrite.assert({
        kind: "product_requirements",
        title: fixture.documents.product_requirements.title,
        content: fixture.documents.product_requirements.content,
      });
      DocumentWrite.assert({
        kind: "build_plan",
        title: fixture.documents.build_plan.title,
        content: fixture.documents.build_plan.content,
      });

      for (const option of fixture.designOptions) {
        DesignBundle.assert(option.bundle);
        expect(option.bundle.files["designs/screens/home.html"]).toBeDefined();
      }
      AppBundle.assert(fixture.app);
    }
  });

  test("seeds each stage and respects --approve / --no-approve", async () => {
    for (const stage of SEED_STAGES) {
      const deps = createInMemorySeedDeps();
      const result = await seedDevelopmentProjects(deps, {
        fixture: "habit-tracker",
        stage,
        approve: true,
      });
      expect(result.projects).toHaveLength(1);
      const seeded = result.projects[0]!;
      expect(seeded.stage).toBe(stage);
      expect(seeded.awaitingApproval).toEqual([]);
      if (stage === "shipped") {
        expect(seeded.shippedAt).not.toBeNull();
        expect(seeded.artifacts.map((item) => item.kind)).toContain("app");
      }
    }

    const unapprovedDeps = createInMemorySeedDeps();
    const unapprovedPlanning = await seedDevelopmentProjects(unapprovedDeps, {
      fixture: "field-service-dispatch",
      stage: "planning",
      approve: false,
    });
    expect(unapprovedPlanning.projects[0]!.awaitingApproval).toEqual([
      "constraints",
      "approaches",
      "product_requirements",
    ]);
  });

  test("parses CLI arguments and renders help usage", () => {
    expect(SEED_PROJECT_FIXTURES).toHaveLength(3);
    expect(seedUsageText()).toContain("Usage: bun run dev:seed");
    const parsed = parseSeedCliArgs([
      "--fixture=clinical-trial-intake",
      "--stage=ready_to_build",
      "--no-approve",
      "--tenant=tenant-custom",
    ]);
    expect(parsed.help).toBe(false);
    expect(parsed.options).toEqual({
      fixture: "clinical-trial-intake",
      stage: "ready_to_build",
      approve: false,
      tenantId: "tenant-custom",
    });
  });
});
