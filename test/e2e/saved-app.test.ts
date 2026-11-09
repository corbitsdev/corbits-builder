import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import { createArtifact, writeArtifactVersion } from "@corbits/artifacts";
import {
  createAgentRepoStore,
  createAssetService,
  DEFAULT_ASSET_REF,
  type RepoStore,
} from "@intx/hub-sessions";
import type {
  AcceptanceChecklist,
  AppSnapshotReceipt,
  LiveApp,
} from "@corbits-builder/schemas/artifact";
import { ensureAppAsset } from "@corbits-builder/hub/projects/app-repository";
import { loadHubSigningKey } from "@corbits-builder/hub/signing-key";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;
let repoStore: RepoStore;

beforeAll(async () => {
  hub = await startInProcessHub();
  repoStore = createAgentRepoStore({
    dataDir: hub.dataDir,
    signingKey: await loadHubSigningKey(hub.dataDir),
  }).repoStore;
});

afterAll(() => hub?.close());

const appFiles = (checklist: string) => ({
  "package.json": "{}",
  "ACCEPTANCE.md": checklist,
});

// A project whose coder run has ended.
async function seedProject() {
  const { projectId, person, path } = await hub.seedProject("Saved app");
  const coder = await hub.seedRun(person, "coder");
  let app: string | undefined;
  // The project's app repository, created as the hub creates it for the coder's first push.
  const repository = () =>
    ensureAppAsset(
      hub.db,
      createAssetService({ db: hub.db, repoStore }),
      person.tenantId,
      projectId,
      person.principalId,
    );
  return {
    path,
    coder,
    // The next version of the project's app, as the coder's sidecar files it once check-app
    // passes, or as a person's Save files it.
    async file(checklist: string, source: "check" | "snapshot" = "check") {
      const content = JSON.stringify({ files: appFiles(checklist) });
      const version = {
        scope: person,
        title: "App",
        content,
        metadata: {
          source,
          runId: coder.id,
          bytes: Buffer.byteLength(content),
        },
      };
      if (app)
        await writeArtifactVersion(hub.db, { ...version, artifactId: app });
      else
        app = (
          await hub.db.transaction((tx) =>
            createArtifact(tx, {
              ...version,
              ownerPrincipalId: person.principalId,
              kind: "app",
              source: { origin: "workflow" },
            }),
          )
        ).id;
    },
    repository,
    // A coder's push to the project's app repository's main.
    async push(checklist: string) {
      const assetId = await repository();
      await repoStore.writeTree(
        { kind: "hub" },
        { kind: "app", id: assetId },
        DEFAULT_ASSET_REF,
        { files: appFiles(checklist), message: "Edit" },
      );
    },
  };
}

// What the download, the acceptance route and the live app each read.
async function readBack(path: string) {
  const archive = await JSZip.loadAsync(
    await (await hub.call("GET", `${path}/app/archive`)).arrayBuffer(),
  );
  const live = await hub.json<LiveApp>(hub.call("GET", `${path}/app`));
  return {
    download: await archive.file("Saved-app/ACCEPTANCE.md")?.async("string"),
    checklist: (
      await hub.json<AcceptanceChecklist>(hub.call("GET", `${path}/acceptance`))
    ).markdown,
    live: live.source,
  };
}

test("a coder's push right after its check is what the download, the checklist and the live app read once its workspace is gone", async () => {
  const project = await seedProject();
  await project.file("# Checked\n");
  await project.push("# Pushed\n");

  expect(await readBack(project.path)).toEqual({
    download: "# Pushed\n",
    checklist: "# Pushed\n",
    live: "repository",
  });
});

test("a project with filed versions and no app repository reads its main-line version, never a person's Save", async () => {
  const project = await seedProject();
  await project.file("# Checked\n");
  await project.file("# Saved\n", "snapshot");

  expect(await readBack(project.path)).toEqual({
    download: "# Checked\n",
    checklist: "# Checked\n",
    live: "filed",
  });
});

test("a filed version stays the saved app while the app repository holds no app yet", async () => {
  const project = await seedProject();
  await project.file("# Checked\n");
  await project.repository();

  expect(await readBack(project.path)).toEqual({
    download: "# Checked\n",
    checklist: "# Checked\n",
    live: "filed",
  });
});

test("an export after a Save carries the version it filed in build/", async () => {
  const project = await seedProject();
  await project.push("# Pushed\n");
  await mkdir(project.coder.workspace, { recursive: true });
  for (const [path, content] of Object.entries(appFiles("# Workspace\n")))
    await writeFile(join(project.coder.workspace, path), content);
  const { artifact } = await hub.json<AppSnapshotReceipt>(
    hub.call("POST", `${project.path}/app/snapshot`),
  );

  const archive = await JSZip.loadAsync(
    await (
      await hub.call(
        "GET",
        `${project.path}/export/archive?version=${String(artifact.version)}`,
      )
    ).arrayBuffer(),
  );
  expect(await archive.file("build/ACCEPTANCE.md")?.async("string")).toBe(
    "# Workspace\n",
  );
});
