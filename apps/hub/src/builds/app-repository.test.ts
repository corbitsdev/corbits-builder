import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAppRepository,
  EDIT,
  type AppPushAccess,
} from "./app-repository.ts";

const roots: string[] = [];
afterAll(() =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

// A repository over an app workspace whose every push access request is answered by access, so
// a version fails, or waits, before it touches git.
async function repository(access: () => Promise<AppPushAccess>) {
  const root = await mkdtemp(join(tmpdir(), "sb-app-repository-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "package.json"), "{}");
  return createAppRepository({
    workspace,
    access,
    revoke: async () => undefined,
    sign: async () => "",
  });
}

// Push access that fails with each reason in turn, once its release is called; requested settles
// once a request waits on its release.
function held() {
  const releases: (() => void)[] = [];
  let waiting = Promise.withResolvers<void>();
  let requests = 0;
  return {
    access: () =>
      new Promise<never>((_, reject) => {
        requests += 1;
        const reason = `refused ${String(requests)}`;
        releases.push(() => reject(new Error(reason)));
        waiting.resolve();
      }),
    release: () => {
      releases.shift()?.();
      if (releases.length === 0) waiting = Promise.withResolvers<void>();
    },
    requested: () => waiting.promise,
    requests: () => requests,
  };
}

const live = () => new AbortController().signal;

test("a check's failed version is told by versionChecked alone", async () => {
  const app = await repository(async () => {
    throw new Error("refused");
  });

  expect(await app.versionChecked(live())).toEqual({
    failure: "refused",
    stopped: false,
  });
  expect(app.unheard()).toBeUndefined();
});

test("a check the tool stops waiting on leaves its failure for the next tool result", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const push = held();
    const app = await repository(push.access);
    const stop = new AbortController();
    const waiting = app.versionChecked(stop.signal);
    await push.requested();
    stop.abort(new Error("tool stopped"));

    await expect(waiting).rejects.toThrow("tool stopped");
    push.release();
    await app.idle();
    expect(app.unheard()).toContain("refused 1");
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", record);
  }
});

test("a check while the repository closes is not reported as saved", async () => {
  const push = held();
  const app = await repository(push.access);
  app.schedule(EDIT);
  await push.requested();
  const closing = app.close(AbortSignal.timeout(2000));

  expect(await app.versionChecked(live())).toEqual({
    failure: expect.stringMatching(/^app_repository_closing:/),
    stopped: true,
  });
  push.release();
  await closing;
});

test("an edit after a queued check joins it, and the check waits for that one version", async () => {
  const push = held();
  const app = await repository(push.access);
  app.schedule(EDIT);
  await push.requested();
  const checked = app.versionChecked(live());
  app.schedule(EDIT);
  push.release();
  await push.requested();
  push.release();

  expect((await checked)?.failure).toBe("refused 2");
  expect(push.requests()).toBe(2);
});
