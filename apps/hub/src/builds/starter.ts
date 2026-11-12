import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { hasCode } from "@intx/types";
import { isWorkflowAction } from "@corbits-builder/plugin-host/catalog";
import {
  AppBundle,
  type ArtifactContent,
} from "@corbits-builder/schemas/artifact";
import { unpackDesign, writeBundle } from "../artifacts/design-tools.ts";
import { bundleFiles } from "./app-snapshot.ts";
import type { AppRepository } from "./app-repository.ts";
import {
  CODER_INPUTS,
  DESIGNER_INPUTS,
  INPUTS_DIRECTORY,
  KIT_DIGEST,
  SKILLS_DIRECTORY,
  inputFile,
  inputPath,
} from "../config/inputs.ts";
import { CATALOG } from "../plugins/catalog.ts";
import {
  checkScript,
  kitDigest,
  starterFiles,
  watchScript,
} from "@corbits-builder/coder/assets" with { type: "macro" };
import { designStarterFiles } from "@corbits-builder/designer/skills" with { type: "macro" };

const STARTER = starterFiles();
const DESIGN_STARTER = designStarterFiles();
export const STARTER_INDEX = DESIGN_STARTER[".builder/designs/index.html"]!;
export const STARTER_HOME_SCREEN =
  DESIGN_STARTER[".builder/designs/screens/home.html"]!;
const KIT = kitDigest();
export const CHECK_APP = checkScript();
export const WATCH_PAGE = watchScript();

const SCREENS_PLACEHOLDER = "<!-- builder:screens -->";
const SCREENS_START = "<!-- builder:screens:start -->";
const SCREENS_END = "<!-- builder:screens:end -->";
const SPLICED_BLOCK =
  /<!-- builder:screens:start -->[\s\S]*?<!-- builder:screens:end -->/;

function cleanScreenBody(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  return body.replace(/<script\b[\s\S]*?<\/script>/gi, "").trim();
}

function screenNameOf(file: string, html: string): string {
  const match = html.match(/data-screen=["']([^"']+)["']/);
  if (match?.[1] !== undefined) return match[1];
  return basename(file, ".html");
}

function normalizeScreenHtml(file: string, cleaned: string): string {
  if (/data-screen=/.test(cleaned)) return cleaned;
  const name = screenNameOf(file, cleaned);
  return `<section data-screen="${name}">\n${cleaned}\n</section>`;
}

const isStarterHome = (file: string, html: string) =>
  file === "home.html" &&
  (html === STARTER_HOME_SCREEN || html.trim() === STARTER_HOME_SCREEN.trim());

// Splices per-screen HTML files into the mockup shell's <!-- builder:screens --> marker (or
// <main>), wrapping the spliced markup in start/end markers so repeated calls replace the
// previously spliced block in place.
export function spliceDesignScreens(
  indexHtml: string,
  screens: Readonly<Record<string, string>>,
): string {
  const shell = indexHtml.replace(SPLICED_BLOCK, "");
  const inline = new Set(
    [...shell.matchAll(/data-screen=["']([^"']+)["']/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );
  const nonEmpty = Object.entries(screens)
    .map(([path, raw]) => [basename(path), cleanScreenBody(raw), raw] as const)
    .filter(([, cleaned]) => cleaned.length > 0);
  const hasOtherScreen =
    nonEmpty.some(([file]) => file !== "home.html") || inline.size > 0;
  const active = nonEmpty.filter(([file, cleaned, raw]) => {
    if (hasOtherScreen && isStarterHome(file, raw)) return false;
    return !inline.has(screenNameOf(file, cleaned));
  });
  if (active.length === 0) {
    if (SPLICED_BLOCK.test(indexHtml))
      return indexHtml.replace(SPLICED_BLOCK, () => SCREENS_PLACEHOLDER);
    return indexHtml;
  }
  const order = [...shell.matchAll(/href=["']#\/([^/"'\s]+)/g)].flatMap(
    (match) => (match[1] === undefined ? [] : [match[1]]),
  );
  const rank = (entry: readonly [string, string, string]) => {
    const pos = order.indexOf(screenNameOf(entry[0], entry[1]));
    return pos === -1 ? order.length : pos;
  };
  const joined = active
    .sort((a, b) => rank(a) - rank(b) || a[0].localeCompare(b[0]))
    .map(([file, cleaned]) => normalizeScreenHtml(file, cleaned))
    .join("\n");
  const marked = `${SCREENS_START}\n${joined}\n${SCREENS_END}`;
  if (SPLICED_BLOCK.test(indexHtml))
    return indexHtml.replace(SPLICED_BLOCK, () => marked);
  if (indexHtml.includes(SCREENS_PLACEHOLDER))
    return indexHtml.replace(SCREENS_PLACEHOLDER, () => marked);
  if (/<\/main>/i.test(indexHtml))
    return indexHtml.replace(/<\/main>/i, (tag) => `${marked}\n${tag}`);
  return `${indexHtml}\n${marked}`;
}

export const STARTER_SPLICED_INDEX = spliceDesignScreens(STARTER_INDEX, {
  "home.html": STARTER_HOME_SCREEN,
});

// Re-splices .builder/designs/screens/*.html into .builder/designs/index.html on disk whenever
// a design write completes, and drops the untouched starter home.html once another screen exists.
export async function syncDesignScreensOnDisk(
  workspaceDir: string,
): Promise<void> {
  const designsDir = join(workspaceDir, ".builder", "designs");
  const indexPath = join(designsDir, "index.html");
  const screensDir = join(designsDir, "screens");
  let indexHtml: string;
  let entries;
  try {
    indexHtml = await readFile(indexPath, "utf8");
    entries = await readdir(screensDir, { withFileTypes: true });
  } catch (error) {
    if (hasCode(error) && error.code === "ENOENT") return;
    throw error;
  }
  const screens: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    try {
      screens[entry.name] = await readFile(
        join(screensDir, entry.name),
        "utf8",
      );
    } catch (error) {
      if (hasCode(error) && error.code === "ENOENT") continue;
      throw error;
    }
  }
  const hasCustomScreen = Object.entries(screens).some(
    ([name, content]) =>
      name !== "home.html" && cleanScreenBody(content).length > 0,
  );
  if (
    hasCustomScreen &&
    screens["home.html"] !== undefined &&
    isStarterHome("home.html", screens["home.html"])
  ) {
    delete screens["home.html"];
    await rm(join(screensDir, "home.html"), { force: true });
  }
  const spliced = spliceDesignScreens(indexHtml, screens);
  if (spliced !== indexHtml) await writeFile(indexPath, spliced);
}
// Chrome for Testing's headless shell, the browser check-app drives.
const CHROME_VERSION = "156.0.8078.4";
const CHROME_PLATFORMS: Record<string, string> = {
  "darwin-arm64": "mac-arm64",
  "darwin-x64": "mac-x64",
  "linux-arm64": "linux-arm64",
  "linux-x64": "linux64",
};
const CHROME_PLATFORM = CHROME_PLATFORMS[`${process.platform}-${process.arch}`];
const BROWSER_DOWNLOAD_MS = 300_000;
const chrome = `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/${CHROME_PLATFORM}/chrome-headless-shell-${CHROME_PLATFORM}.zip`;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

// One Chrome for every sandbox, unpacked once beside the hub's other caches and only ever read by
// the sandboxes. On a host Chrome for Testing has no build for, no browser is installed and
// check-app reports it missing.
const BROWSER_CACHE = join(
  homedir(),
  ".cache",
  "corbits-builder",
  "browsers",
  CHROME_VERSION,
);
let installing: Promise<string | undefined> | undefined;

// Each sidecar process may race to install; every one unpacks into its own folder and the first
// rename wins.
async function installBrowser() {
  if (!CHROME_PLATFORM) return undefined;
  if (await exists(BROWSER_CACHE)) return realpath(BROWSER_CACHE);
  await mkdir(dirname(BROWSER_CACHE), { recursive: true });
  const staging = await mkdtemp(`${BROWSER_CACHE}-`);
  try {
    const response = await fetch(chrome, {
      signal: AbortSignal.timeout(BROWSER_DOWNLOAD_MS),
    });
    if (!response.ok)
      throw new Error(`browser_download_failed: ${response.status} ${chrome}`);
    const archive = join(staging, "chrome.zip");
    await Bun.write(archive, response);
    const unzip = Bun.spawn(["/usr/bin/unzip", "-q", archive, "-d", staging], {
      stdout: "ignore",
      stderr: "pipe",
    });
    if ((await unzip.exited) !== 0)
      throw new Error(
        `browser_unpack_failed: ${await new Response(unzip.stderr).text()}`,
      );
    await rm(archive);
    await rename(staging, BROWSER_CACHE).catch(async (error: unknown) => {
      if (!(await exists(BROWSER_CACHE))) throw error;
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return realpath(BROWSER_CACHE);
}

/** The shared Chrome install's folder, holding chrome-headless-shell-<platform>/. */
export function sharedBrowser() {
  installing ??= installBrowser();
  installing.catch(() => (installing = undefined));
  return installing;
}

type ReadFiled = (kind: string) => Promise<ArtifactContent | undefined>;
type ReadBundle = () => Promise<Readonly<Record<string, string>> | undefined>;

// The files of every skill pack of an action that starts this workflow, each in its pack's folder.
const packFiles = (workflow: string) =>
  Object.fromEntries(
    CATALOG.actions
      .filter(isWorkflowAction)
      .filter((action) => action.builder.start.workflow === workflow)
      .flatMap((action) => action.packs)
      .flatMap(({ path, files }) =>
        Object.entries(files).map(([file, text]) => [
          `${SKILLS_DIRECTORY}/${path}/${file}`,
          text,
        ]),
      ),
  );

// Every warm writes the current filed inputs afresh: the role's documents and skill packs under
// INPUTS_DIRECTORY, and for an app the component kit digest beside them and the design unpacked
// into .builder.
async function writeInputs(
  kind: "app" | "design",
  workspace: string,
  read: ReadFiled,
) {
  await rm(join(workspace, INPUTS_DIRECTORY), { recursive: true, force: true });
  for (const input of kind === "app" ? CODER_INPUTS : DESIGNER_INPUTS) {
    const document = await read(input);
    if (document)
      await writeBundle(workspace, {
        [inputPath(input)]: inputFile(document, kind === "app"),
      });
  }
  await writeBundle(
    workspace,
    packFiles(kind === "app" ? "coder" : "designer"),
  );
  if (kind !== "app") return;
  await writeBundle(workspace, { [KIT_DIGEST]: KIT });
  const design = await read("design");
  if (design) await unpackDesign(design.content, workspace);
}

const THEME_STYLES = join("designs", "styles.css");

async function seedFiles(
  kind: "app" | "design",
  read: ReadFiled,
  readTheme: ReadBundle,
  readPrevious: ReadBundle,
): Promise<Record<string, string | Uint8Array>> {
  if (kind === "app") {
    const filedApp = await read("app");
    return filedApp
      ? bundleFiles(AppBundle.assert(JSON.parse(filedApp.content)))
      : STARTER;
  }
  const previous = await readPrevious();
  if (previous)
    return {
      ...DESIGN_STARTER,
      ...Object.fromEntries(
        Object.entries(previous).map(([path, text]) => [
          join(".builder", path),
          text,
        ]),
      ),
    };
  const styles = (await readTheme())?.[THEME_STYLES];
  return styles
    ? { ...DESIGN_STARTER, [join(".builder", THEME_STYLES)]: styles }
    : DESIGN_STARTER;
}

// Seeds a fresh workspace and returns the setup command the sandbox must still run, if any: an app
// is a checkout of its repository's main once main holds a version; before then, or while the
// repository is unavailable, it starts from the project's filed app when there is one, else from
// the app starter; a seed made while the repository is unavailable becomes a version on top of main
// once it is reachable. A design starts from the draft an earlier designer left for its concept, else
// from the design starter in the stylesheet of the theme its concept starts from; the theme's sample
// screens and DESIGN.md only preview it. The marker sits beside the workspace, out of the sandbox's
// reach, and is written only once setup succeeded, so a sidecar that restarts mid-setup runs it
// again.
export async function prepareWorkspace(
  kind: "app" | "design",
  workspace: string,
  read: ReadFiled,
  readTheme: ReadBundle = async () => undefined,
  readPrevious: ReadBundle = async () => undefined,
  app?: { repository: AppRepository; signal: AbortSignal },
) {
  if (app) await app.repository.prepare(app.signal);
  const seeded =
    kind === "app" ? "package.json" : join(".builder", "DESIGN.md");
  if (!(await exists(join(workspace, seeded))))
    await writeBundle(
      workspace,
      await seedFiles(kind, read, readTheme, readPrevious),
    );
  await writeInputs(kind, workspace, read);
  const marker = join(dirname(workspace), ".workspace-ready");
  if (kind !== "app" || (await exists(marker))) return undefined;
  return {
    command: "bun install --frozen-lockfile",
    done: () => writeFile(marker, ""),
  };
}
