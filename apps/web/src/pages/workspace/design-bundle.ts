/**
 * A design bundle as the designer files it: its files by path, and the pages built from them for
 * a frame. A page has its stylesheet inlined and its screens spliced in, and carries the script
 * through which the frame and the pane around it talk.
 */
import { type } from "arktype";
import { DesignBundle } from "@corbits-builder/schemas/artifact";
import { readJson } from "../../json.ts";

export const MAX_QUOTE_CHARS = 600;
export const MAX_SCREEN_CHARS = 512;
const MAX_EXCERPT_CHARS = 160;
const MAX_PIN_NAME_CHARS = 40;
const MAX_PIN_NAME_WORDS = 4;
const MAX_SCREENS = 100;

// What the frame's page may send, checked before the parent acts on it: the page is the designer's
// code, so only plain values of a bounded size are taken.
const Name = type.string.atLeastLength(1).atMostLength(MAX_SCREEN_CHARS);

/** The page's data-screen sections, each with its data-state sections. */
export const FrameScreens = type({ screen: "string", states: "string[]" })
  .array()
  .atMostLength(MAX_SCREENS);
export type FrameScreens = typeof FrameScreens.infer;

/** The screen and state the page left unhidden. */
export const FrameShown = type({ screen: Name, state: Name.or("null") });
export type FrameShown = typeof FrameShown.infer;

/** The place a click hit while tagging was on. */
export const FrameTag = type({
  "+": "reject",
  page: Name,
  "screen?": Name,
  "state?": Name,
  "testid?": Name,
  "id?": Name,
  tag: Name,
  "excerpt?": type.string.atLeastLength(1).atMostLength(MAX_EXCERPT_CHARS),
  box: ["number", "number", "number", "number"],
});
export type FrameTag = typeof FrameTag.infer;

const Fraction = type("0 <= number <= 1");

/**
 * Where in the tagged element the click fell, as fractions of its box, and the click in the page's
 * own coordinates for an element the page cannot find again; with the element's own short name,
 * from its label or heading, when it has one.
 */
export const FrameSpot = type({
  "+": "reject",
  spot: [Fraction, Fraction],
  point: ["number", "number"],
  "name?": type.string.atLeastLength(1).atMostLength(MAX_PIN_NAME_CHARS),
});
export type FrameSpot = typeof FrameSpot.infer;

/** A numbered pin the page draws over a tagged place, and the name it reads out. */
export type FramePin = {
  number: number;
  label: string;
  selected: boolean;
  testid?: string;
  id?: string;
  spot: FrameSpot["spot"];
  point: FrameSpot["point"];
};

/** The value read by a frame message type, or null when the page sent something else. */
export function fromFrame<T>(
  parse: (value: unknown) => T | type.errors,
  value: unknown,
): T | null {
  const read = parse(value);
  return read instanceof type.errors ? null : read;
}
export const INDEX_PAGE = "index.html";

export const DESIGN_MEDIA_TYPE = "application/vnd.corbits-builder.design+json";

export type DesignFiles = Readonly<Record<string, string>>;

export type MockupScreen = { page: string; hash: string };

export function parseBundle(content: string): Record<string, string> | null {
  return readJson(content, DesignBundle)?.files ?? null;
}

const SCREEN_PREFIX = "designs/screens/";
// A bundle without the page is drawn from its screens alone.
const BLANK_PAGE = "";
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
  return path.slice(SCREEN_PREFIX.length, -".html".length);
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

function screenFragments(files: DesignFiles, page: string): string {
  const inline = new Set(
    [...page.matchAll(/data-screen=["']([^"']+)["']/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    ),
  );
  const raw = Object.entries(files).filter(
    ([path]) => path.startsWith(SCREEN_PREFIX) && path.endsWith(".html"),
  );
  const filtered = raw.filter(([path, html]) => {
    if (
      path === "designs/screens/home.html" &&
      html.trim() === STARTER_HOME_SCREEN &&
      (raw.length > 1 || inline.size > 0)
    )
      return false;
    return !inline.has(screenNameOf(path, html));
  });
  const order = [...page.matchAll(/href=["']#\/([^/"'\s]+)/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
  const rank = (entry: readonly [string, string]) => {
    const index = order.indexOf(screenNameOf(entry[0], entry[1]));
    return index === -1 ? order.length : index;
  };
  return filtered
    .sort((a, b) => rank(a) - rank(b) || a[0].localeCompare(b[0]))
    .map(([path, html]) => normalizeScreenHtml(path, html))
    .join("\n");
}

function spliceScreens(page: string, fragments: string): string {
  if (fragments.length === 0) return page;
  if (/<\/main>/i.test(page))
    return page.replace(/<\/main>/i, (tag) => `${fragments}\n${tag}`);
  return `${page}\n${fragments}`;
}

function mockupPage(files: DesignFiles, page: string, head: string): string {
  const withScreens = spliceScreens(page, screenFragments(files, page));
  const inlined = withScreens.replace(
    /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g,
    (link, href: string) => {
      const css = files[`designs/${href}`];
      return css === undefined
        ? link
        : `<style>${css.replaceAll("</style", "<\\/style")}</style>`;
    },
  );
  return /<head[^>]*>/i.test(inlined)
    ? inlined.replace(/<head[^>]*>/i, (tag) => `${tag}${head}`)
    : head + inlined;
}

function bundlePages(files: DesignFiles): string[] {
  return Object.keys(files)
    .filter(
      (path) =>
        path.startsWith("designs/") &&
        !path.startsWith(SCREEN_PREFIX) &&
        path.endsWith(".html"),
    )
    .map((path) => path.slice("designs/".length));
}

const scriptJson = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

// The frame cannot be read across origins, so the page reports its screen (page and hash route)
// and is rebuilt on the screen the person was looking at. A link to another page of the bundle
// asks the parent for that page; any other link would leave the offline mockup and blank the
// frame, so it goes nowhere. The listener captures before the mockup's own script sees the click.
// Selected text is reported too, so it can be offered to the person's message. Screens and states
// are read from the page's own data-screen / data-state sections for the pane's Screen menu, which
// also replaces any in-page mockup bar, so the frame shows only the app. The screen and state the
// menu marks are the sections the mockup left unhidden, read after its own hashchange routing has
// run, since a route such as #/home may show a state the hash does not name. Look tweaks arrive as
// a stylesheet the page keeps over its own tokens. While the parent has tagging on, a click names
// the place it hit (nearest data-testid, else id, else the element) and the mockup never sees it:
// the listener is the page's first, on the window, in the capture phase.
function navigator(pages: readonly string[], screen: MockupScreen): string {
  return `<script>(()=>{const pages=${scriptJson(pages)},here=${scriptJson(screen.page)},start=${scriptJson(screen.hash)};let tagging=false;const cap=(v,n)=>typeof v==="string"&&v.trim()?v.replace(/\\s+/g," ").trim().slice(0,n):undefined;addEventListener("click",(e)=>{if(!tagging||(e.target instanceof Element&&e.target.closest("[data-builder-pins]")))return;e.preventDefault();e.stopImmediatePropagation();if(!(e.target instanceof Element))return;const el=e.target.closest("[data-testid]")??e.target.closest("[id]")??e.target,r=el.getBoundingClientRect(),at={page:cap(here,${String(MAX_SCREEN_CHARS)}),tag:el.tagName.toLowerCase(),box:[r.left,r.top,r.width,r.height].map(Math.round)},more={screen:cap(e.target.closest("[data-screen]")?.dataset.screen,${String(MAX_SCREEN_CHARS)}),state:cap(e.target.closest("[data-state]")?.dataset.state,${String(MAX_SCREEN_CHARS)}),testid:cap(el.getAttribute("data-testid"),${String(MAX_SCREEN_CHARS)}),id:cap(el.id,${String(MAX_SCREEN_CHARS)}),excerpt:cap(el.textContent,${String(MAX_EXCERPT_CHARS)})};for(const k in more)if(more[k]!==undefined)at[k]=more[k];const within=(v)=>Math.min(1,Math.max(0,v)),spot={spot:[r.width?within((e.clientX-r.left)/r.width):0.5,r.height?within((e.clientY-r.top)/r.height):0.5],point:[e.clientX+scrollX,e.clientY+scrollY]},name=cap(el.getAttribute("aria-label")??el.querySelector("h1,h2,h3,h4,h5,h6")?.textContent??el.textContent,${String(MAX_PIN_NAME_CHARS + 1)});if(name&&name.length<=${String(MAX_PIN_NAME_CHARS)}&&name.split(" ").length<=${String(MAX_PIN_NAME_WORDS)})spot.name=name;parent.postMessage({designTag:at,designSpot:spot},"*");},true);const pinHost=document.createElement("div"),pinRoot=pinHost.attachShadow({mode:"open"}),pinStyle=document.createElement("style");let drawn=[],placing=false;pinHost.setAttribute("data-builder-pins","");pinHost.style.cssText="all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647";pinStyle.textContent="button{all:initial;position:absolute;box-sizing:border-box;min-width:24px;height:24px;padding:0 7px;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;border-radius:12px;background:#18181b;color:#fff;font:600 12px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;box-shadow:0 0 0 2px #fff,0 2px 6px rgb(0 0 0/.3);cursor:pointer;pointer-events:auto;transition:transform .15s cubic-bezier(.2,.8,.2,1)}button[data-selected]{transform:translate(-50%,-50%) scale(1.2);box-shadow:0 0 0 2px #fff,0 0 0 4px #18181b,0 2px 8px rgb(0 0 0/.35)}button:focus-visible{outline:2px solid #2563eb;outline-offset:4px}";const pinAt=(p)=>{if(p.testid===undefined&&p.id===undefined)return[p.point[0]-scrollX,p.point[1]-scrollY];const el=[...document.querySelectorAll(p.testid===undefined?"#"+CSS.escape(p.id):'[data-testid="'+CSS.escape(p.testid)+'"]')].find((x)=>x.getClientRects().length>0);if(!el)return null;const r=el.getBoundingClientRect();return[r.left+p.spot[0]*r.width,r.top+p.spot[1]*r.height];};const place=()=>{for(const[b,p]of drawn){const at=pinAt(p);b.style.visibility=at?"visible":"hidden";if(at){b.style.left=at[0]+"px";b.style.top=at[1]+"px";}}placing=drawn.length>0;if(placing)requestAnimationFrame(place);};const drawPins=(list)=>{pinRoot.replaceChildren(pinStyle);drawn=list.map((p)=>{const b=document.createElement("button");b.type="button";b.textContent=String(p.number);b.setAttribute("aria-label",p.label);if(p.selected)b.setAttribute("data-selected","");b.addEventListener("click",(e)=>{e.stopPropagation();parent.postMessage({designPin:p.number},"*");});pinRoot.append(b);return[b,p];});if(!pinHost.isConnected)document.documentElement.append(pinHost);if(!placing)place();};addEventListener("click",(e)=>{const a=e.target instanceof Element?e.target.closest("a[href]"):null;if(!a)return;const href=a.getAttribute("href")??"";if(href.startsWith("#"))return;e.preventDefault();const u=new URL(href,"http://mockup/"+here);const page=decodeURIComponent(u.pathname.slice(1));if(u.origin==="http://mockup"&&pages.includes(page))parent.postMessage({designPage:page,designScreen:u.hash},"*");},true);if(start&&!location.hash)location.hash=start;const seen=()=>{const s=[...document.querySelectorAll("[data-screen]")].find((e)=>!e.hidden);if(!s)return null;const st=[...s.querySelectorAll(":scope > [data-state]")].find((e)=>!e.hidden);return{screen:s.dataset.screen,state:st?st.dataset.state:null};};const t=()=>parent.postMessage({designScreen:location.hash,designShown:seen()},"*");addEventListener("hashchange",()=>setTimeout(t));t();addEventListener("mouseup",()=>{const s=getSelection(),q=s?s.toString().trim():"";if(!q||!s.rangeCount)return;const r=s.getRangeAt(0).getBoundingClientRect();parent.postMessage({designQuote:q.slice(0,${String(MAX_QUOTE_CHARS)}),at:[r.left,r.bottom]},"*");});const hide=document.createElement("style");hide.textContent=".mock-bar{display:none!important}";document.head.append(hide);addEventListener("DOMContentLoaded",()=>{const designScreens=[...document.querySelectorAll("[data-screen]")].map((s)=>({screen:s.dataset.screen,states:[...s.querySelectorAll(":scope > [data-state]")].map((e)=>e.dataset.state)}));parent.postMessage({designScreens,designTheme:!!document.querySelector("[data-theme-toggle]")},"*");t();});addEventListener("message",(e)=>{if(e.source!==parent)return;const go=e.data?.designGoto;if(typeof go==="string")location.hash=go;if(Array.isArray(e.data?.designPins))drawPins(e.data.designPins);if(typeof e.data?.designTagging==="boolean"){tagging=e.data.designTagging;document.documentElement.style.cursor=tagging?"crosshair":"";}if(e.data?.designToggleTheme===true)document.querySelector("[data-theme-toggle]")?.click();const tw=e.data?.designTweaks;if(typeof tw==="string"){let st=document.getElementById("builder-tweaks");if(!st){st=document.createElement("style");st.id="builder-tweaks";document.head.append(st);}st.textContent=tw;}});})()</script>`;
}

/** The bundle's first page as it loads, for a still preview that is never navigated. */
export const firstPage = (files: DesignFiles): string =>
  mockupPage(files, files[`designs/${INDEX_PAGE}`] ?? BLANK_PAGE, "");

export function screenPage(files: DesignFiles, screen: MockupScreen): string {
  const at =
    files[`designs/${screen.page}`] === undefined
      ? { page: INDEX_PAGE, hash: "" }
      : screen;
  return mockupPage(
    files,
    files[`designs/${at.page}`] ?? BLANK_PAGE,
    navigator(bundlePages(files), at),
  );
}
