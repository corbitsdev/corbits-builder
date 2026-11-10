/**
 * A design bundle as the designer files it: its files by path, and the pages built from them for
 * a frame. A page has its stylesheet inlined and its screens spliced in, and carries the script
 * through which the frame and the pane around it talk.
 */
import { DesignBundle } from "@corbits-builder/schemas/artifact";
import { readJson } from "../../json.ts";

export const MAX_QUOTE_CHARS = 600;
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
// a stylesheet the page keeps over its own tokens.
function navigator(pages: readonly string[], screen: MockupScreen): string {
  return `<script>(()=>{const pages=${scriptJson(pages)},here=${scriptJson(screen.page)},start=${scriptJson(screen.hash)};addEventListener("click",(e)=>{const a=e.target instanceof Element?e.target.closest("a[href]"):null;if(!a)return;const href=a.getAttribute("href")??"";if(href.startsWith("#"))return;e.preventDefault();const u=new URL(href,"http://mockup/"+here);const page=decodeURIComponent(u.pathname.slice(1));if(u.origin==="http://mockup"&&pages.includes(page))parent.postMessage({designPage:page,designScreen:u.hash},"*");},true);if(start&&!location.hash)location.hash=start;const seen=()=>{const s=[...document.querySelectorAll("[data-screen]")].find((e)=>!e.hidden);if(!s)return null;const st=[...s.querySelectorAll(":scope > [data-state]")].find((e)=>!e.hidden);return{screen:s.dataset.screen,state:st?st.dataset.state:null};};const t=()=>parent.postMessage({designScreen:location.hash,designShown:seen()},"*");addEventListener("hashchange",()=>setTimeout(t));t();addEventListener("mouseup",()=>{const s=getSelection(),q=s?s.toString().trim():"";if(!q||!s.rangeCount)return;const r=s.getRangeAt(0).getBoundingClientRect();parent.postMessage({designQuote:q.slice(0,${String(MAX_QUOTE_CHARS)}),at:[r.left,r.bottom]},"*");});const hide=document.createElement("style");hide.textContent=".mock-bar{display:none!important}";document.head.append(hide);addEventListener("DOMContentLoaded",()=>{const designScreens=[...document.querySelectorAll("[data-screen]")].map((s)=>({screen:s.dataset.screen,states:[...s.querySelectorAll(":scope > [data-state]")].map((e)=>e.dataset.state)}));parent.postMessage({designScreens,designTheme:!!document.querySelector("[data-theme-toggle]")},"*");t();});addEventListener("message",(e)=>{if(e.source!==parent)return;const go=e.data?.designGoto;if(typeof go==="string")location.hash=go;if(e.data?.designToggleTheme===true)document.querySelector("[data-theme-toggle]")?.click();const tw=e.data?.designTweaks;if(typeof tw==="string"){let st=document.getElementById("builder-tweaks");if(!st){st=document.createElement("style");st.id="builder-tweaks";document.head.append(st);}st.textContent=tw;}});})()</script>`;
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
