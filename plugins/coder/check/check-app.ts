// check-app: checks the app's README (and user manual, once written), builds the app, starts it,
// and opens every page it links to in a headless browser at a desktop and a phone width, saving a
// desktop picture of each page under docs/manual/ when a manual uses them. Exits non-zero when
// anything a person would hit is broken.
// check-app <folder>: serves that folder of static files (a design mockup) instead, and also fails
// on any request that leaves it, since a mockup must render offline, and checks the DESIGN.md beside
// the folder and the mockup's look against the kit's starting point.
// Every run ends with the checklist of RULES, each passed or failed with what failed it.
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { failedScript } from "./steps.ts";

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(
    "check-app            check the app here, or the mockup in .builder/designs when there is no app\ncheck-app <folder>   check that folder of static files as a mockup",
  );
  process.exit(0);
}

// A designer's workspace holds a mockup and no app, so a bare run checks the mockup. A page
// passed instead of its folder checks the folder it sits in.
const argument =
  process.argv[2] &&
  (await stat(process.argv[2]).catch(() => undefined))?.isFile()
    ? dirname(process.argv[2])
    : process.argv[2];
const staticRoot =
  argument ??
  ((await Bun.file(".builder/designs/index.html").exists()) &&
  !(await Bun.file("package.json").exists())
    ? ".builder/designs"
    : undefined);

// In the order they run; a problem's kind names the rule it breaks.
const RULES = [
  {
    kind: "docs",
    rule: "README.md and docs/USER-MANUAL.md describe this app, the manual with pictures from docs/manual/",
    app: true,
  },
  {
    kind: "design doc",
    rule: "DESIGN.md is written for this app, with no template placeholder left",
    app: false,
  },
  {
    kind: "coverage",
    rule: "DESIGN.md names every interface requirement (IR-n) the requirements list, when they list any, and every screen it lists is in the mockup",
    app: false,
  },
  {
    kind: "tokens",
    rule: "the primary colour and the typeface are this product's, not the kit's defaults",
    app: false,
  },
  {
    kind: "decoration",
    rule: "surfaces are solid colour tokens and UI text carries no emoji",
    app: false,
  },
  { kind: "typecheck", rule: "bun run typecheck passes", app: true },
  { kind: "build", rule: "bun run build passes", app: true },
  {
    kind: "start",
    rule: "bun run start answers on PORT within 15 s",
    app: true,
  },
  { kind: "browser", rule: "the headless browser is installed" },
  {
    kind: "errors",
    rule: "pages run without uncaught, console or browser errors",
  },
  { kind: "requests", rule: "every request a page makes succeeds" },
  {
    kind: "offline",
    rule: "the mockup makes no request outside itself",
    app: false,
  },
  { kind: "blank", rule: "every page shows text" },
  { kind: "scroll", rule: "no page scrolls sideways" },
  { kind: "off screen", rule: "text stays inside the screen" },
  { kind: "spills out", rule: "controls stay inside their boxes" },
  {
    kind: "navigation",
    rule: "navigation sits above the page heading on desktop and shows its links",
  },
  {
    kind: "dead controls",
    rule: "every link reaches a screen and state that exist, and every button opens, closes, toasts, toggles or links",
    app: false,
  },
  {
    kind: "manual",
    rule: "every picture the manual shows is of a page that was opened and exists after capture, every element it highlights is found, and every area of the app that was opened appears in the manual",
    app: true,
  },
].filter((rule) => rule.app === undefined || rule.app === !staticRoot);
const SHOWN_PER_RULE = 10;

type Problem = { page?: string; width?: number; kind: string; detail: string };

// Layout problems a person sees at a glance and a text-only model cannot, measured from the live
// page. A mockup and app once passed every crash check with the main navigation below the
// content, stage selects spilling out of their cards and the logo cut off the left edge.
interface LayoutProblem {
  kind: string;
  detail: string;
}

// Evaluated in the page; returns LayoutProblem[].
const LAYOUT_SCRIPT = `(() => {
  const LIMIT = 5;
  const problems = [];
  const counts = {};
  const add = (kind, detail) => {
    counts[kind] = (counts[kind] || 0) + 1;
    if (counts[kind] <= LIMIT) problems.push({ kind, detail });
  };
  const name = (el) => {
    const id = el.getAttribute("data-testid");
    const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ").slice(0, 40);
    return el.tagName.toLowerCase() + (id ? "[" + id + "]" : "") + (text ? ' "' + text + '"' : "");
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0 && r.width > 0 && r.height > 0;
  };
  const ownText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
  // Off-canvas drawers, menus, marquees and skip links are positioned or moved on purpose; content
  // inside a sideways-scrolling box may run past the screen edge.
  const tucked = (el, scrolling) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (["fixed", "absolute", "sticky"].includes(s.position) || s.transform !== "none") return true;
      if (scrolling && a !== el && s.overflowX !== "visible") return true;
    }
    return false;
  };
  const all = [...document.body.querySelectorAll("*")].filter(visible);
  const texts = all.filter(ownText).filter((el) => !tucked(el, false)).slice(0, 400);

  for (const el of texts) {
    const r = el.getBoundingClientRect();
    if ((r.right <= 0 || r.left >= innerWidth - 1 || r.left < -2 || r.right > innerWidth + 2) && !tucked(el, true))
      add("off screen", name(el) + " runs past the edge of the screen");
  }

  for (let i = 0; i < texts.length; i++) {
    // Line boxes, so two inline runs wrapping across the same lines do not count.
    const as = [...texts[i].getClientRects()];
    for (let j = i + 1; j < texts.length; j++) {
      if (texts[i].contains(texts[j]) || texts[j].contains(texts[i])) continue;
      const hit = [...texts[j].getClientRects()].some((b) => as.some((a) => {
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return w > 0 && h > 0 && w * h > 0.25 * Math.min(a.width * a.height, b.width * b.height);
      }));
      if (hit) add("overlap", name(texts[i]) + " overlaps " + name(texts[j]));
    }
  }

  const boxed = (el) => {
    const s = getComputedStyle(el);
    return (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent") || parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0;
  };
  const controls = all.filter((el) => el.matches("button, input, select, textarea, [role=button], [role=combobox]") && !tucked(el, false));
  for (const el of controls) {
    let box = el.parentElement;
    while (box && box !== document.body && !boxed(box)) box = box.parentElement;
    if (!box || box === document.body || getComputedStyle(box).overflow !== "visible") continue;
    const r = el.getBoundingClientRect();
    const c = box.getBoundingClientRect();
    if (r.left < c.left - 2 || r.right > c.right + 2 || r.bottom > c.bottom + 2)
      add("spills out", name(el) + " extends outside " + name(box));
  }

  const navs = [...document.querySelectorAll("nav, [role=navigation]")].filter(visible);
  const main = navs.sort((x, y) => y.querySelectorAll("a").length - x.querySelectorAll("a").length)[0];

  // A link counts as shown when a click at its centre lands on it, so a box that clips it or a
  // layer over it hides it. Links off the screen, such as in a closed drawer, are left out.
  const links = main ? [...main.querySelectorAll("a")].filter(visible) : [];
  const onScreen = links.filter((a) => {
    const r = a.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
  });
  const shown = onScreen.filter((a) =>
    [...a.getClientRects()].some((r) => a.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))),
  );
  if (onScreen.length >= 2 && shown.length < 2) {
    // backdrop-filter, filter, transform and the like make an ancestor the box a fixed element is
    // placed in, so a fixed sidebar inside the header is sized to the header.
    let why = "";
    if (getComputedStyle(main).position === "fixed")
      for (let a = main.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const s = getComputedStyle(a);
        const traps = ["backdropFilter", "filter", "transform", "perspective", "contain", "willChange"]
          .filter((p) => s[p] && !["none", "auto", "normal"].includes(s[p]))
          .map((p) => p.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + ": " + s[p]);
        if (traps.length) {
          why = "; it is position: fixed inside " + a.tagName.toLowerCase() + (a.className ? "." + String(a.className).trim().split(/ +/).join(".") : "") + ", whose " + traps.join(", ") + " makes that element the box it is placed and sized in, so keep those off the navigation's ancestors";
          break;
        }
      }
    add("navigation", name(main) + " shows " + shown.length + " of its " + onScreen.length + " links on screen; it is " + Math.round(main.getBoundingClientRect().height) + "px tall" + why);
  }

  if (innerWidth >= 1024) {
    const heading = [...document.querySelectorAll("main h1, h1")].find(visible);
    if (heading && main && getComputedStyle(main).position !== "fixed") {
      const n = main.getBoundingClientRect();
      const h = heading.getBoundingClientRect();
      if (n.top > h.bottom) add("navigation", name(main) + " starts below the page heading " + name(heading));
    }
  }
  return problems;
})()`;
type Cdp<T> = MessageEvent<T>;

// A manual picture is captured from the page whose slug starts its file name: docs/manual/<slug>.png
// or docs/manual/<slug>.<anything>.png. Its title `highlight: <css selector> | <text>` names the
// element to outline; the text after the bar, matched against what the element shows, is optional.
interface Picture {
  file: string;
  caption: string;
  highlight: { selector: string; text: string | undefined } | undefined;
}

const MANUAL = join("docs", "manual");
const slugOf = (path: string) =>
  path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "home";

// Evaluated in the page; returns why it could not draw the highlight, or null.
const highlightScript = (
  selector: string,
  text: string | undefined,
  label: string,
) => `(() => {
  const want = ${JSON.stringify(text?.toLowerCase() ?? "")};
  let found;
  try {
    found = [...document.querySelectorAll(${JSON.stringify(selector)})];
  } catch {
    return ${JSON.stringify(`"${selector}" is not a valid CSS selector`)};
  }
  const shows = (el) => [el.innerText, el.value, el.getAttribute("aria-label"), el.getAttribute("title")]
    .some((value) => typeof value === "string" && value.toLowerCase().includes(want));
  const el = found.find((el) => el.getClientRects().length > 0 && shows(el));
  if (!el) return ${JSON.stringify(`no visible element matches ${selector}${text ? ` showing "${text}"` : ""}`)};
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.id = "__check_app_highlight";
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const ring = document.createElement("div");
  ring.style.cssText = "position:fixed;box-sizing:border-box;border:4px solid #ff1f8f;border-radius:12px;box-shadow:0 0 0 2px #fff";
  Object.assign(ring.style, { left: r.left - 8 + "px", top: r.top - 8 + "px", width: r.width + 16 + "px", height: r.height + 16 + "px" });
  const tag = document.createElement("div");
  tag.textContent = ${JSON.stringify(label)};
  tag.style.cssText = "position:fixed;background:#ff1f8f;color:#fff;font:600 14px/1.2 system-ui,sans-serif;padding:4px 10px;border-radius:8px;white-space:nowrap;box-shadow:0 0 0 2px #fff";
  tag.style.top = (r.top > 40 ? r.top - 40 : r.bottom + 14) + "px";
  tag.style.left = Math.max(4, Math.min(r.left - 8, innerWidth - 8 - ${label.length * 8 + 24})) + "px";
  layer.append(ring, tag);
  document.body.append(layer);
  return null;
})()`;

const WIDTHS = [
  [1280, 800],
  [390, 844],
] as const;
const MAX_PAGES = 30;
// run_shell's executor stops a command at 120 s; stop crawling early enough to print a result.
const DEADLINE = Date.now() + 100_000;
// A word on progress for the person watching, on stderr with the prefix the hub's sandbox relays.
// Only when the hub runs this check: an agent running it itself reads stderr and needs no such lines.
const progress = (line: string) => {
  if (process.env["SB_PROGRESS"]) console.error(`progress: ${line}`);
};

const problems: Problem[] = [];
// Overlap misfired 30 times across 8 well-built sites at two widths, so it is reported, not failed.
const notes: Problem[] = [];
const visited: string[] = [];
const queue = ["/"];
let pictures: Picture[] = [];
let manualWritten = false;
const saved: string[] = [];
const drawn = new Set<string>();

const where = (p: Problem) =>
  p.page === undefined ? "" : `${p.page} at ${p.width}px: `;

// Prints the verdict and the checklist and exits. stoppedAt is the rule a run could not get past;
// the rules after it were not reached.
function finish(stoppedAt?: string): never {
  const unique = [
    ...new Map(
      problems.map((p) => [`${p.page} ${p.kind} ${p.detail}`, p]),
    ).values(),
  ];
  const pages = visited.length ? ` across ${visited.length} page(s)` : "";
  console.log(
    unique.length
      ? `check failed: ${unique.length} problem(s)${pages}`
      : `check passed: ${staticRoot ? `served ${staticRoot}` : "built, started,"} and opened ${visited.join(", ")} at 1280 and 390 px with no errors`,
  );
  const stop = RULES.findIndex((rule) => rule.kind === stoppedAt);
  RULES.forEach(({ kind, rule }, index) => {
    if (stop !== -1 && index > stop)
      return console.log(`- ${rule} (not reached)`);
    const failed = unique.filter((p) => p.kind === kind);
    console.log(`${failed.length ? "✗" : "✓"} ${rule}`);
    for (const p of failed.slice(0, SHOWN_PER_RULE))
      console.log(`    ${where(p)}${p.detail.slice(0, 400)}`);
    if (failed.length > SHOWN_PER_RULE)
      console.log(`    and ${failed.length - SHOWN_PER_RULE} more`);
  });
  const unvisited = [
    ...new Set(queue.filter((link) => !visited.includes(link))),
  ];
  if (stop === -1 && unvisited.length)
    console.log(`not opened (page or time limit): ${unvisited.join(", ")}`);
  if (saved.length) console.log(`pictures saved: ${saved.join(", ")}`);
  const noted = [
    ...new Map(notes.map((p) => [`${p.page} ${p.detail}`, p])).values(),
  ];
  if (noted.length)
    console.log(
      `layout notes (check these look intended):\n${noted
        .slice(0, 20)
        .map((p) => `- ${where(p)}${p.detail.slice(0, 200)}`)
        .join("\n")}`,
    );
  process.exit(unique.length ? 1 : 0);
}

function fail(kind: string, detail: string): never {
  problems.push({ kind, detail });
  finish(kind);
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no free port")),
      );
    });
  });

// The kit's values as the designer's starter ships them (plugins/designer/starter).
const KIT_PRIMARY = "#e98428";
const KIT_FONT = '"Red Hat Display", "Open Sans", Roboto, Arial, sans-serif';
const GRADIENT = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/g;
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/gu;
// Prose in angle brackets, like <App name>; HTML tags carry attributes and code is stripped first.
const PLACEHOLDER = /<[A-Za-z][^<>=`"]*\s[^<>=`"]*>/g;

const STARTER_HOME_SCREEN = [
  '<section data-screen="home" data-testid="screen-home">',
  '  <div data-state="populated" data-testid="home-populated">',
  '    <h1 data-testid="home-title">Hello, world</h1>',
  "  </div>",
  "</section>",
].join("\n");

function screenNameOf(path: string, html: string): string {
  const match = html.match(/data-screen=["']([^"']+)["']/);
  if (match?.[1] !== undefined) return match[1];
  return basename(path, ".html");
}

function normalizeScreenHtml(path: string, html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const withoutScripts = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .trim();
  if (/data-screen=/.test(withoutScripts)) return withoutScripts;
  const name = screenNameOf(path, withoutScripts);
  return `<section data-screen="${name}">\n${withoutScripts}\n</section>`;
}

function spliceScreens(index: string, entries: [string, string][]): string {
  const inline = new Set(
    [...index.matchAll(/data-screen=["']([^"']+)["']/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    ),
  );
  const filtered = entries.filter(([path, html]) => {
    if (
      path === "screens/home.html" &&
      html.trim() === STARTER_HOME_SCREEN &&
      (entries.length > 1 || inline.size > 0)
    )
      return false;
    return !inline.has(screenNameOf(path, html));
  });
  if (!filtered.length) return index;
  const order = [...index.matchAll(/href=["']#\/([^/"'\s]+)/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
  const rank = (entry: [string, string]) => {
    const pos = order.indexOf(screenNameOf(entry[0], entry[1]));
    return pos === -1 ? order.length : pos;
  };
  const fragments = filtered
    .sort((a, b) => rank(a) - rank(b) || a[0].localeCompare(b[0]))
    .map(([path, html]) => normalizeScreenHtml(path, html))
    .join("\n");
  if (/<\/main>/i.test(index))
    return index.replace(/<\/main>/i, (tag) => `${fragments}\n${tag}`);
  return `${index}\n${fragments}`;
}

async function readMockupIndex(root: string): Promise<string | undefined> {
  const index = Bun.file(join(root, "index.html"));
  if (!(await index.exists())) return undefined;
  const paths = await Array.fromAsync(
    new Bun.Glob("screens/*.html").scan({ cwd: root }),
  );
  const entries = await Promise.all(
    paths.map(async (path): Promise<[string, string]> => [
      path,
      await Bun.file(join(root, path)).text(),
    ]),
  );
  return spliceScreens(await index.text(), entries);
}

// The workspace's documents sit in .inputs beside .builder.
async function checkCoverage(
  root: string,
  design: string,
  mockup: string | undefined,
) {
  const requirements = Bun.file(
    join(root, "..", "..", ".inputs", "requirements.md"),
  );
  const section = (await requirements.exists())
    ? (await requirements.text())
        .split(/^## Interface requirements/m)[1]
        ?.split(/^## /m)[0]
    : undefined;
  // A design made from an instruction alone has no interface requirements to cover.
  const ids = [...new Set(section?.match(/\bIR-\d+\b/g))];
  const unnamed = ids.filter((id) => !new RegExp(`\\b${id}\\b`).test(design));
  if (unnamed.length)
    problems.push({
      kind: "coverage",
      detail: `DESIGN.md names no screen or data source for ${unnamed.join(", ")} from the requirements`,
    });
  const screens = new Set(
    [
      ...(mockup === undefined
        ? []
        : mockup.matchAll(/data-screen=["']([^"']+)["']/g)),
    ].map((m) => m[1]),
  );
  const missing = [
    ...new Set(
      [...design.matchAll(/\(mockup `#\/([^/`]+)/g)].map(
        ([, name]) => name ?? "",
      ),
    ),
  ].filter((name) => name && !name.startsWith("<") && !screens.has(name));
  if (missing.length)
    problems.push({
      kind: "coverage",
      detail: `DESIGN.md lists screen(s) the mockup has no data-screen for: ${missing.join(", ")}`,
    });
}

async function checkDesign(root: string, mockup: string | undefined) {
  const doc = Bun.file(join(root, "..", "DESIGN.md"));
  const design = (await doc.exists()) ? await doc.text() : undefined;
  // The person may ask for emoji; the direction records it on its Icons line.
  const emojiChosen = /^- Icons:(?!.*lucide).*\bemoji\b/im.test(design ?? "");
  if (design === undefined)
    problems.push({ kind: "design doc", detail: "DESIGN.md is missing" });
  else {
    const prose = design
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "");
    const left = [
      ...new Set(
        prose
          .match(PLACEHOLDER)
          ?.map((p) => p.replace(/\s+/g, " ").slice(0, 40)),
      ),
    ];
    if (left.length)
      problems.push({
        kind: "design doc",
        detail: `DESIGN.md still has ${left.length} template placeholder(s): ${left.slice(0, 5).join(", ")}`,
      });
    await checkCoverage(root, design, mockup);
  }
  const files = await Array.fromAsync(
    new Bun.Glob("**/*.{html,css,js}").scan({ cwd: root }),
  );
  for (const path of files.sort()) {
    const text = await Bun.file(join(root, path)).text();
    const light = text.match(/:root\s*\{[^}]*\}/)?.[0] ?? "";
    if (
      light
        .match(/--primary:\s*([^;]+);/)?.[1]
        ?.trim()
        .toLowerCase() === KIT_PRIMARY
    )
      problems.push({
        kind: "tokens",
        detail: `${path}: --primary is still the kit's ${KIT_PRIMARY}; set the hue this product's direction calls for`,
      });
    if (light.match(/--font-sans:\s*([^;]+);/)?.[1]?.trim() === KIT_FONT)
      problems.push({
        kind: "tokens",
        detail: `${path}: --font-sans is still the kit's stack; set a type voice from fonts every device has`,
      });
    const gradients = text.match(GRADIENT)?.length ?? 0;
    if (gradients)
      problems.push({
        kind: "decoration",
        detail: `${path}: ${gradients} CSS gradient(s); give each surface a solid colour token`,
      });
    const emoji = emojiChosen ? [] : (text.match(EMOJI) ?? []);
    if (emoji.length)
      problems.push({
        kind: "decoration",
        detail: `${path}: ${emoji.length} emoji (${[...new Set(emoji)].slice(0, 5).join(" ")}); use lucide icons or words, or record the person's request for emoji on DESIGN.md's Icons line`,
      });
  }
}

let origin: string;
let stop: () => void;
if (staticRoot) {
  const root = resolve(staticRoot);
  const indexHtml = await readMockupIndex(root);
  await checkDesign(root, indexHtml);
  const files = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const target = join(
        root,
        path.endsWith("/") ? `${path}index.html` : path,
      );
      if (target === join(root, "index.html") && indexHtml !== undefined)
        return new Response(indexHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      const file = Bun.file(target);
      return (await file.exists()) &&
        resolve(file.name ?? "").startsWith(root + sep)
        ? new Response(file)
        : new Response("not found", { status: 404 });
    },
  });
  origin = `http://127.0.0.1:${files.port}`;
  stop = () => files.stop(true);
} else {
  // The manual is part of a finished app. Until it is written the rest of the check still runs and
  // saves the pictures it will show, so its absence is reported here rather than stopping the run.
  manualWritten = await Bun.file("docs/USER-MANUAL.md").exists();
  if (!manualWritten)
    problems.push({
      kind: "docs",
      detail:
        "docs/USER-MANUAL.md is missing: the app ships a user manual for the people who use it, in plain language, with pictures from docs/manual/",
    });
  for (const doc of manualWritten
    ? ["README.md", "docs/USER-MANUAL.md"]
    : ["README.md"]) {
    const file = Bun.file(doc);
    if (!(await file.exists())) fail("docs", `${doc} is missing`);
    const text = await file.text();
    if (text.includes("<!-- starter placeholder"))
      fail("docs", `${doc} is still the starter's placeholder`);
    const local = text.match(
      /(localhost|127\.0\.0\.1|0\.0\.0\.0):\d+|\/Users\/|\/home\/|[A-Z]:\\/,
    );
    if (local)
      fail(
        "docs",
        `${doc} names "${local[0]}"; say "the address the server prints" and use relative paths`,
      );
  }
  const manual = manualWritten
    ? await Bun.file("docs/USER-MANUAL.md").text()
    : "";
  pictures = [
    ...manual.matchAll(
      /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)|<img\b[^>]*\bsrc=["']([^"']+)/g,
    ),
  ]
    .map(([, caption = "", markdown, title, img]) => {
      const highlight = title?.match(
        /^\s*highlight:\s*([^|]+?)\s*(?:\|\s*(.+?)\s*)?$/,
      );
      return {
        file: join("docs", decodeURIComponent(markdown ?? img!)),
        caption,
        highlight: highlight
          ? { selector: highlight[1]!, text: highlight[2] }
          : undefined,
      };
    })
    .filter(({ file }) => file.startsWith(MANUAL + sep));
  // Reported, not stopped at: the run goes on to save the pictures the manual can then show.
  if (manualWritten && !pictures.length)
    problems.push({
      kind: "docs",
      detail:
        "docs/USER-MANUAL.md shows no picture of the app from docs/manual/",
    });
  // Vite builds code that does not typecheck, so a pass would otherwise not mean the code compiles.
  for (const script of ["typecheck", "build"]) {
    const failed = await failedScript(script);
    if (failed !== undefined) fail(script, failed);
  }
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  progress("checking the app: starting it");
  const server = Bun.spawn(["bun", "run", "start"], {
    env: { ...process.env, PORT: String(port) },
    stdout: "ignore",
    stderr: "pipe",
  });
  const serverLog = new Response(server.stderr).text();
  let up = false;
  for (let attempt = 0; attempt < 60 && !up; attempt++) {
    up = await fetch(origin).then(
      (response) => response.ok,
      () => false,
    );
    if (!up) await Bun.sleep(250);
  }
  if (!up) {
    server.kill();
    fail("start", `no answer; its output:\n${(await serverLog).slice(-3000)}`);
  }
  stop = () => server.kill();
}

// The sandbox setup unpacks Chrome's headless shell under $HOME/browsers. A sandboxed process may not
// register Mach services, so Chrome runs as one process with its own sandbox off.
// With no browser installed the folder is not there at all, which is the same finding.
const installedBrowsers = async () => {
  try {
    return await Array.fromAsync(
      new Bun.Glob("chrome-headless-shell-*/chrome-headless-shell").scan({
        cwd: join(homedir(), "browsers"),
        absolute: true,
      }),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
};
const [chrome] = await installedBrowsers();
if (!chrome) {
  stop();
  fail("browser", "nothing under $HOME/browsers");
}

// The mockup's script routes #/screen/state and wires these hooks; anything else does nothing.
const DEAD_CONTROLS_SCRIPT = `(() => {
  const name = (el) => el.dataset.testid || el.textContent.trim().replace(/\\s+/g, " ").slice(0, 40);
  const dead = [];
  const linked = new Set();
  for (const a of document.querySelectorAll('a[href^="#/"]')) {
    const [screen, state] = a.getAttribute("href").slice(2).split("/");
    linked.add(screen);
    const target = [...document.querySelectorAll("[data-screen]")].find((s) => s.dataset.screen === screen);
    if (!target) dead.push(name(a) + " links to #/" + screen + ", which has no data-screen");
    else if (state && !target.querySelector(":scope > [data-state='" + state + "']"))
      dead.push(name(a) + " links to state " + state + " of " + screen + ", which has no such data-state");
  }
  for (const s of document.querySelectorAll("[data-screen]"))
    if (s.dataset.screen && !linked.has(s.dataset.screen))
      dead.push("screen " + s.dataset.screen + " has no #/" + s.dataset.screen + " link to reach it");
  for (const el of document.querySelectorAll("[data-open]:not([data-open=true]):not([data-open=false])"))
    if (document.getElementById(el.dataset.open)?.tagName !== "DIALOG")
      dead.push(name(el) + " opens #" + el.dataset.open + ", which is not a dialog");
  for (const el of document.querySelectorAll("[data-toast]"))
    if (!document.getElementById(el.dataset.toast))
      dead.push(name(el) + " shows toast #" + el.dataset.toast + ", which is missing");
  const hooks = "[data-open],[data-close],[data-toast],[data-theme-toggle],[data-menu-toggle],[aria-pressed],[role=tab]";
  for (const button of document.querySelectorAll("button:not([disabled])"))
    if (!button.matches(hooks) && !button.closest("a[href]") && !(button.type === "submit" && button.closest("form[method=dialog]")))
      dead.push(name(button) + " does nothing: give it data-open, data-close, data-toast, aria-pressed or role=tab, or make it a link");
  return [...new Set(dead)];
})()`;

let page = "/";
let width: number = WIDTHS[0][0];
const report = (kind: string, detail: unknown) =>
  problems.push({ page, width, kind, detail: String(detail) });
const describe = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "description" in value)
    return value.description;
  return JSON.stringify(value);
};

const view = new Bun.WebView({
  backend: {
    type: "chrome",
    path: chrome,
    argv: ["--single-process", "--no-zygote", "--no-sandbox"],
  },
  width,
  height: WIDTHS[0][1],
  console: (type, ...args) => {
    if (type === "error")
      report("errors", `console error: ${args.map(describe).join(" ")}`);
  },
});
await view.navigate(origin);
await view.cdp("Network.enable");
await view.cdp("Log.enable");

// By request id: a redirect announces the same id again but finishes once.
const inFlight = new Set<string>();
let lastActivity = Date.now();
const started = (id: string) => {
  inFlight.add(id);
  lastActivity = Date.now();
};
const finished = (id: string) => {
  inFlight.delete(id);
  lastActivity = Date.now();
};
view.addEventListener(
  "Runtime.exceptionThrown",
  (
    event: Cdp<{
      exceptionDetails: { text: string; exception?: { description?: string } };
    }>,
  ) =>
    report(
      "errors",
      `uncaught error: ${event.data.exceptionDetails.exception?.description ?? event.data.exceptionDetails.text}`,
    ),
);
view.addEventListener(
  "Log.entryAdded",
  (event: Cdp<{ entry: { level: string; source: string; text: string } }>) => {
    if (
      event.data.entry.level === "error" &&
      event.data.entry.source !== "network"
    )
      report("errors", `browser error: ${event.data.entry.text}`);
  },
);
view.addEventListener(
  "Network.requestWillBeSent",
  (event: Cdp<{ requestId: string; request: { url: string } }>) => {
    started(event.data.requestId);
    const url = new URL(event.data.request.url);
    if (staticRoot && url.origin !== origin && url.protocol.startsWith("http"))
      report("offline", url.href);
  },
);
view.addEventListener(
  "Network.loadingFinished",
  (event: Cdp<{ requestId: string }>) => finished(event.data.requestId),
);
view.addEventListener(
  "Network.loadingFailed",
  (
    event: Cdp<{ requestId: string; canceled?: boolean; errorText: string }>,
  ) => {
    finished(event.data.requestId);
    if (!event.data.canceled)
      report("requests", `failed: ${event.data.errorText}`);
  },
);
view.addEventListener(
  "Network.responseReceived",
  (event: Cdp<{ response: { status: number; url: string } }>) => {
    if (event.data.response.status >= 400)
      report(
        "requests",
        `HTTP ${event.data.response.status} ${event.data.response.url}`,
      );
  },
);

// The page's picture at desktop width, then each highlighted picture the manual names for it.
const capture = async (path: string) => {
  const slug = slugOf(path);
  await mkdir(MANUAL, { recursive: true });
  const plain = join(MANUAL, `${slug}.png`);
  await Bun.write(plain, await view.screenshot());
  saved.push(plain);
  for (const picture of pictures) {
    const name = basename(picture.file);
    if (
      !picture.highlight ||
      !(name === `${slug}.png` || name.startsWith(`${slug}.`))
    )
      continue;
    const { selector, text } = picture.highlight;
    const label = (text ?? picture.caption).slice(0, 40);
    const missing = await view.evaluate<string | null>(
      highlightScript(selector, text, label),
    );
    drawn.add(picture.file);
    if (missing) {
      report("manual", `${picture.file}: ${missing}`);
      continue;
    }
    await Bun.write(picture.file, await view.screenshot());
    if (!saved.includes(picture.file)) saved.push(picture.file);
    await view.evaluate(
      `document.getElementById("__check_app_highlight").remove()`,
    );
  }
};

// Quiet for 1.5 s: long enough for a data library's first retry (TanStack Query waits 1 s) to fail.
// A stream or long poll never finishes, so a page settles after 5 s at most.
const settle = async () => {
  const deadline = Math.min(Date.now() + 5_000, DEADLINE);
  while (
    Date.now() < deadline &&
    (inFlight.size > 0 || Date.now() - lastActivity < 1_500)
  )
    await Bun.sleep(100);
  inFlight.clear();
};

while (queue.length && visited.length < MAX_PAGES && Date.now() < DEADLINE) {
  const path = queue.shift()!;
  if (visited.includes(path)) continue;
  visited.push(path);
  const ahead = new Set(queue.filter((link) => !visited.includes(link))).size;
  progress(
    `${staticRoot ? "checking the mockup" : "checking the app"}: page ${String(visited.length)}, ${String(ahead)} more to open`,
  );
  page = path;
  for (const [w, h] of WIDTHS) {
    width = w;
    await view.resize(w, h);
    // A hash-only change never finishes a navigation, so every visit starts from a blank page.
    await view.navigate("about:blank");
    await view.navigate(origin + path);
    await settle();
    const facts = await view.evaluate<{
      text: number;
      overflow: boolean;
      links: string[];
    }>(`({
      text: document.body.innerText.trim().length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      links: [...document.querySelectorAll("a[href]")]
        .map((a) => new URL(a.href, location.href))
        .filter((url) => url.origin === location.origin)
        .map((url) => url.pathname + url.hash),
    })`);
    if (facts.text === 0) report("blank", "the page shows no text");
    if (facts.overflow) report("scroll", "content is wider than the screen");
    for (const found of await view.evaluate<LayoutProblem[]>(LAYOUT_SCRIPT))
      if (found.kind === "overlap") notes.push({ page, width, ...found });
      else report(found.kind, found.detail);
    queue.push(...facts.links.filter((link) => !visited.includes(link)));
    // Every page's picture is saved whether or not the manual shows it yet, so writing the manual
    // starts from pictures of the app as it is.
    if (!staticRoot && w === WIDTHS[0][0]) await capture(path);
    if (staticRoot && visited.length === 1 && w === WIDTHS[0][0])
      for (const detail of await view.evaluate<string[]>(DEAD_CONTROLS_SCRIPT))
        report("dead controls", detail);
  }
}
view.close();
stop();
if (!visited.length)
  fail(
    "errors",
    "no page was opened: the steps before the browser used up the 100 s time limit",
  );
// A highlight capture either saved its picture or already reported why it could not.
const openedSlugs = visited.map(slugOf);
const pageOf = (picture: Picture) => basename(picture.file).split(".")[0]!;
for (const picture of pictures)
  if (picture.highlight) {
    if (!drawn.has(picture.file))
      problems.push({
        kind: "manual",
        detail: `${picture.file} highlights an element, but its name starts with no opened page's slug (${openedSlugs.join(", ")})`,
      });
  } else if (!openedSlugs.includes(pageOf(picture)))
    // The manual follows the app: a picture of a page that is gone was left by an earlier version.
    problems.push({
      kind: "manual",
      detail: `docs/USER-MANUAL.md shows ${picture.file}, but no opened page is named ${pageOf(picture)}; the page may have moved or gone (opened: ${openedSlugs.join(", ")})`,
    });
  else if (!(await Bun.file(picture.file).exists()))
    problems.push({
      kind: "manual",
      detail: `docs/USER-MANUAL.md shows ${picture.file}, which is not there; the pictures saved are ${saved.join(", ")}`,
    });
// And an area of the app the manual never shows is a change it has not caught up with. An area is
// a page's first path segment, so one picture covers every record a list opens onto.
if (!staticRoot && manualWritten) {
  const areaOf = (path: string) =>
    slugOf(
      new URL(path, "http://app").pathname.split("/").filter(Boolean)[0] ?? "/",
    );
  const shown = pictures.map(pageOf);
  for (const area of new Set(visited.map(areaOf)))
    if (!shown.some((page) => page === area || page.startsWith(`${area}-`)))
      problems.push({
        kind: "manual",
        detail: `docs/USER-MANUAL.md shows no picture of ${area === "home" ? "the home page" : `the ${area} pages`}; a picture of each page opened is saved under docs/manual/`,
      });
}
finish();
