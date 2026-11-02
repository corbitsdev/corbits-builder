/**
 * The designer's mockup as the person reviews it: a bundle page with its stylesheet inlined, run
 * in a frame that allows scripts (hash navigation and the state switcher) but stays cross-origin,
 * so it cannot reach the workspace or the session.
 */
import { StatusDot } from "@corbits/react-ui";
import { MenuGroup, MenuItem, MenuLabel } from "@corbits/react-ui/ui/menu";
import { Check, ChevronDown, Palette, SunMoon } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { wording } from "../../config.ts";
import { Markdown } from "../../markdown.jsx";
import { keys } from "../../queries/keys.ts";
import { readProjectActivity } from "../../api/activity.ts";
import { readDesignDraft } from "../../api/artifacts.ts";
import { DevicePreview, type PreviewDevice } from "./device-preview.tsx";
import type { PaneBarGroup } from "./pane-bar.tsx";
import { QuoteOffer } from "./passage-note.tsx";
import {
  mockupLook,
  tweakCss,
  TweakPanel,
  type LookTweaks,
} from "./mockup-tweaks.tsx";

const DRAFT_REFRESH_MS = 12_000;
const DESIGNER_ACTIVITY_MS = 2_000;
const FILE_WRITES = new Set(["write_file", "edit_file"]);
const MAX_SCREEN_CHARS = 512;
const MAX_QUOTE_CHARS = 600;
const MAX_SCREENS = 100;
const INDEX_PAGE = "index.html";

export const DESIGN_MEDIA_TYPE = "application/vnd.corbits-builder.design+json";

export type DesignFiles = Readonly<Record<string, string>>;

type MockupScreen = { page: string; hash: string };

type ScreenEntry = { screen: string; states: readonly string[] };

function parseScreens(value: unknown): readonly ScreenEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_SCREENS) return null;
  const entries = value.filter(
    (item): item is ScreenEntry =>
      typeof (item as ScreenEntry | null)?.screen === "string" &&
      Array.isArray((item as ScreenEntry).states) &&
      (item as ScreenEntry).states.every((state) => typeof state === "string"),
  );
  return entries.length === value.length ? entries : null;
}

type ShownScreen = { screen: string; state: string | null };

function parseShown(value: unknown): ShownScreen | null {
  const shown = value as Partial<ShownScreen> | null;
  if (
    typeof shown?.screen !== "string" ||
    shown.screen.length > MAX_SCREEN_CHARS
  )
    return null;
  const state = shown.state;
  if (state === null) return { screen: shown.screen, state };
  return typeof state === "string" && state.length <= MAX_SCREEN_CHARS
    ? { screen: shown.screen, state }
    : null;
}

const spoken = (name: string) =>
  name.length === 0
    ? name
    : name[0]!.toUpperCase() + name.slice(1).replaceAll("-", " ");

const stateName = (state: string | null) =>
  state === null || state === "populated"
    ? wording.preview.defaultState
    : spoken(state);

const stateHash = (screen: string, state: string | null) =>
  state === null ? `#/${screen}` : `#/${screen}/${state}`;

export function parseBundle(content: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(content) as { files?: unknown };
    return typeof parsed.files === "object" && parsed.files !== null
      ? (parsed.files as Record<string, string>)
      : null;
  } catch {
    return null;
  }
}

const SCREEN_PREFIX = "designs/screens/";
const STARTER_HOME_MARK = '<h1 data-testid="home-title">Hello, world</h1>';

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
      html.includes(STARTER_HOME_MARK) &&
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
  mockupPage(files, files[`designs/${INDEX_PAGE}`] ?? "", "");

function screenPage(files: DesignFiles, screen: MockupScreen): string {
  const at =
    files[`designs/${screen.page}`] === undefined
      ? { page: INDEX_PAGE, hash: "" }
      : screen;
  return mockupPage(
    files,
    files[`designs/${at.page}`] ?? "",
    navigator(bundlePages(files), at),
  );
}

/** The unfiled draft's badge, whose dot moves only while its designer is mid-turn. */
export const draftBadge = (working: boolean): PaneBarGroup => [
  {
    id: "draft",
    label: working ? wording.design.draftInProgress : wording.design.draftIdle,
    text: wording.design.draftBadge,
    icon: <StatusDot label="" size="xs" tone="emphasis" live={working} />,
    note: true,
  },
];

/**
 * The bundle in a frame whose links move between the bundle's own screens. The expanded view
 * opens on the screen the person reached, and closing it brings the inline frame there too.
 */
export function MockupFrame({
  files,
  device,
  onDevice,
  leading = [],
  trailing = [],
  onTweaks,
}: {
  files: DesignFiles;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  /** Pane bar groups before the mockup's own screens (the draft's badge). */
  leading?: readonly PaneBarGroup[];
  trailing?: readonly PaneBarGroup[];
  /** Hears the live look tweaks as the person changes them. */
  onTweaks?: (tweaks: LookTweaks) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const expandedFrame = useRef<HTMLIFrameElement>(null);
  const screen = useRef<MockupScreen>({ page: INDEX_PAGE, hash: "" });
  const [visit, setVisit] = useState<MockupScreen>(screen.current);
  const [expandedVisit, setExpandedVisit] = useState<MockupScreen | null>(null);
  const [screens, setScreens] = useState<readonly ScreenEntry[]>([]);
  const [themed, setThemed] = useState(false);
  const [shown, setShown] = useState<ShownScreen | null>(null);
  const [tweaks, setTweaks] = useState<LookTweaks>({});
  const [tweaking, setTweaking] = useState(false);
  const tweakSheet = useRef("");
  tweakSheet.current = tweakCss(tweaks);
  useEffect(() => {
    const message = { designTweaks: tweakSheet.current };
    frame.current?.contentWindow?.postMessage(message, "*");
    expandedFrame.current?.contentWindow?.postMessage(message, "*");
    onTweaks?.(tweaks);
  }, [tweaks]);
  // Every load is a fresh page (another screen, a refreshed draft, the expanded view), so the
  // tweaks go in again as soon as it reports its screens.
  useEffect(() => {
    const reapply = (event: MessageEvent) => {
      const source = event.source;
      if (
        source !== frame.current?.contentWindow &&
        source !== expandedFrame.current?.contentWindow
      )
        return;
      if (
        (event.data as { designScreens?: unknown } | null)?.designScreens ===
        undefined
      )
        return;
      if (tweakSheet.current.length > 0)
        (source as Window).postMessage(
          { designTweaks: tweakSheet.current },
          "*",
        );
    };
    window.addEventListener("message", reapply);
    return () => window.removeEventListener("message", reapply);
  }, []);
  const closeTweaks = useCallback(() => setTweaking(false), []);
  useEffect(() => {
    const keep = (event: MessageEvent) => {
      const inline = event.source === frame.current?.contentWindow;
      if (!inline && event.source !== expandedFrame.current?.contentWindow)
        return;
      const data = event.data as {
        designScreen?: unknown;
        designPage?: unknown;
        designScreens?: unknown;
        designTheme?: unknown;
        designShown?: unknown;
      } | null;
      const listed = parseScreens(data?.designScreens);
      if (inline && listed !== null) {
        setScreens(listed);
        setThemed(data?.designTheme === true);
        return;
      }
      const hash = data?.designScreen;
      if (typeof hash !== "string" || hash.length > MAX_SCREEN_CHARS) return;
      if (inline) setShown(parseShown(data?.designShown));
      const asked = data?.designPage;
      if (typeof asked !== "string") {
        screen.current = { ...screen.current, hash };
        return;
      }
      screen.current = { page: asked, hash };
      (inline ? setVisit : setExpandedVisit)(screen.current);
    };
    window.addEventListener("message", keep);
    return () => window.removeEventListener("message", keep);
  }, []);
  const offer = useContext(QuoteOffer);
  useEffect(() => {
    if (offer === null) return;
    // Only the inline frame: an offer under the modal expanded view could not be clicked.
    const quote = (event: MessageEvent) => {
      const owner = frame.current;
      if (owner === null || event.source !== owner.contentWindow) return;
      const data = event.data as { designQuote?: unknown; at?: unknown } | null;
      const text = data?.designQuote;
      const at = data?.at;
      if (typeof text !== "string" || text.length > MAX_QUOTE_CHARS) return;
      if (
        !Array.isArray(at) ||
        at.length !== 2 ||
        !at.every((n) => typeof n === "number")
      )
        return;
      const box = owner.getBoundingClientRect();
      const [x, y] = at as [number, number];
      offer(text, new DOMRect(box.left + x, box.top + y, 0, 0));
    };
    window.addEventListener("message", quote);
    return () => window.removeEventListener("message", quote);
  }, [offer]);
  // Rebuilt only when the files change or a link opens another page, so an unchanged refresh
  // leaves the frame alone.
  const snapshot = JSON.stringify(files);
  const look = useMemo(
    () => mockupLook(JSON.parse(snapshot) as DesignFiles),
    [snapshot],
  );
  const html = useMemo(
    () => screenPage(JSON.parse(snapshot) as DesignFiles, screen.current),
    [snapshot, visit],
  );
  const expandedHtml = useMemo(
    () =>
      expandedVisit === null
        ? undefined
        : screenPage(JSON.parse(snapshot) as DesignFiles, screen.current),
    [snapshot, expandedVisit],
  );
  const tell = (message: object) =>
    frame.current?.contentWindow?.postMessage(message, "*");
  const current = screens.find((entry) => entry.screen === shown?.screen);
  // Portaled outside the pane, so the grid reads the pane's width when it opens to wrap within it.
  const fitPane = (grid: HTMLDivElement | null) => {
    const pane = frame.current?.closest(".device-preview");
    if (grid !== null && pane)
      grid.style.maxWidth = `min(${String(pane.clientWidth)}px, var(--radix-dropdown-menu-content-available-width, 100vw) - 0.75rem)`;
  };
  const screenGroup: PaneBarGroup = [
    ...(screens.length > 1 || (screens[0]?.states.length ?? 0) > 1
      ? [
          {
            id: "screen",
            label: wording.preview.screen,
            text:
              current === undefined
                ? wording.preview.screen
                : spoken(current.screen),
            icon: <ChevronDown size={12} aria-hidden="true" />,
            menu: (
              <div className="screen-menu" ref={fitPane}>
                {screens.map((entry) => (
                  <MenuGroup
                    key={entry.screen}
                    className="screen-menu-column"
                    aria-label={spoken(entry.screen)}
                  >
                    <MenuLabel aria-hidden="true">
                      {spoken(entry.screen)}
                    </MenuLabel>
                    {(entry.states.length === 0 ? [null] : entry.states).map(
                      (state) => (
                        <MenuItem
                          key={state ?? ""}
                          onSelect={() =>
                            tell({ designGoto: stateHash(entry.screen, state) })
                          }
                        >
                          <span className="version-menu-item">
                            {stateName(state)}
                            {entry === current && shown?.state === state ? (
                              <Check size={14} aria-label="Shown" />
                            ) : null}
                          </span>
                        </MenuItem>
                      ),
                    )}
                  </MenuGroup>
                ))}
              </div>
            ),
          },
        ]
      : []),
    ...(current !== undefined && current.states.length > 1
      ? [
          {
            id: "states",
            label: wording.preview.states(spoken(current.screen)),
            row: current.states.map((state) => ({
              id: `state:${state}`,
              label: stateName(state),
              text: stateName(state),
              active: shown?.state === state,
              onSelect: () =>
                tell({ designGoto: stateHash(current.screen, state) }),
            })),
          },
        ]
      : []),
    {
      id: "tweak",
      label: wording.tweak.open,
      icon: <Palette size={16} aria-hidden="true" />,
      active: tweaking,
      onSelect: () => setTweaking((open) => !open),
    },
    ...(themed
      ? [
          {
            id: "theme",
            label: wording.preview.theme,
            icon: <SunMoon size={16} aria-hidden="true" />,
            onSelect: () => tell({ designToggleTheme: true }),
          },
        ]
      : []),
  ];
  return (
    <DevicePreview
      leading={[...leading, screenGroup]}
      html={html}
      device={device}
      onDevice={onDevice}
      scripts
      frameRef={frame}
      expandedHtml={expandedHtml}
      expandedFrameRef={expandedFrame}
      trailing={trailing}
      overlay={
        tweaking ? (
          <TweakPanel
            look={look}
            tweaks={tweaks}
            onChange={setTweaks}
            onClose={closeTweaks}
          />
        ) : null
      }
      onExpandedChange={(open) => {
        setExpandedVisit(open ? { ...screen.current } : null);
        if (!open) setVisit({ ...screen.current });
      }}
    />
  );
}

/** A design bundle is read as two views: its written plan (DESIGN.md) and its clickable mockup. */
export type DesignPart = "plan" | "mockup";

export function DesignPreview({
  content,
  part,
  device,
  onDevice,
  trailing = [],
}: {
  content: string;
  part: DesignPart;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  trailing?: readonly PaneBarGroup[];
}) {
  const files = parseBundle(content);
  if (!files || files[`designs/${INDEX_PAGE}`] === undefined)
    return <p className="inline-note">This design cannot be shown.</p>;
  if (part === "mockup")
    return (
      <MockupFrame
        files={files}
        device={device}
        onDevice={onDevice}
        trailing={trailing}
      />
    );
  const notes = files["DESIGN.md"];
  return notes === undefined ? (
    <p className="inline-note">{wording.design.noPlan}</p>
  ) : (
    <Markdown source={notes.replace(/^\s*# [^\n]*\n+/, "")} />
  );
}

/**
 * The live designer's unfiled mockup until a design is filed: read again as soon as the activity
 * read shows the designer finish a file write, and on a slower poll in case a write is missed.
 * With a concept, that concept's designer until its option is filed.
 */
export function useDesignDraft(
  projectId: string,
  designFiled: boolean,
  concept?: string,
): DesignFiles | null {
  const draft = useQuery({
    queryKey: keys.designDraft.of(projectId, concept),
    queryFn: () => readDesignDraft(projectId, concept),
    enabled: !designFiled,
    refetchInterval: DRAFT_REFRESH_MS,
    retry: false,
  });
  const activity = useQuery({
    queryKey: keys.projectActivity.of(projectId),
    queryFn: ({ signal }) => readProjectActivity(projectId, signal),
    enabled: !designFiled,
    refetchInterval: (query) =>
      query.state.data?.agents.some((agent) => agent.role === "designer")
        ? DESIGNER_ACTIVITY_MS
        : DRAFT_REFRESH_MS,
    refetchOnWindowFocus: false,
  });
  const lastWrite = (activity.data?.agents ?? [])
    .filter((agent) => agent.role === "designer")
    .flatMap((agent) => agent.tools)
    .filter((tool) => FILE_WRITES.has(tool.name) && !tool.running)
    .map((tool) => `${tool.at} ${tool.subject ?? ""}`)
    .sort()
    .at(-1);
  const { refetch } = draft;
  useEffect(() => {
    if (lastWrite !== undefined) void refetch();
  }, [lastWrite, refetch]);
  return designFiled ? null : (draft.data ?? null);
}
