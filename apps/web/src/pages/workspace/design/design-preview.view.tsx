/**
 * The designer's mockup as the person reviews it: a bundle page with its stylesheet inlined, run
 * in a frame that allows scripts (hash navigation and the state switcher) but stays cross-origin,
 * so it cannot reach the workspace or the session.
 */
import { MenuGroup, MenuItem, MenuLabel } from "@corbits/react-ui/ui/menu";
import { Check, Layers, Palette, PanelsTopLeft, SunMoon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { wording } from "../../../config.ts";
import { InlineNote, MenuItemLabel } from "../../../components.jsx";
import {
  FrameScreens,
  FrameShown,
  fromFrame,
  INDEX_PAGE,
  MAX_SCREEN_CHARS,
  screenPage,
  type DesignFiles,
  type MockupScreen,
} from "./design-bundle.ts";
import { DevicePreview, type PreviewDevice } from "./device-preview.tsx";
import { mockupLook, tweakCss, type LookTweaks } from "./mockup-look.ts";
import type { TweakPanelProps } from "./mockup-tweaks.view.tsx";
import type { PaneBarAction, PaneBarGroup } from "../pane-bar.tsx";
import styles from "./design-preview.module.css";

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

/**
 * The bar's menu of the mockup's screens and the shown screen's states, once the page has listed
 * more than one; `goto` takes the place's hash and `previewOf` the preview the menu fits within.
 */
export function screenActions(
  screens: FrameScreens,
  shown: FrameShown | null,
  goto: (hash: string) => void,
  previewOf: () => Element | null | undefined,
): PaneBarAction[] {
  const current = screens.find((entry) => entry.screen === shown?.screen);
  // Portaled outside the pane, so the grid reads the pane's width when it opens to wrap within it.
  const fitPane = (grid: HTMLDivElement | null) => {
    const pane = previewOf();
    if (grid !== null && pane)
      grid.style.maxWidth = `min(${String(pane.clientWidth)}px, var(--radix-dropdown-menu-content-available-width, 100vw) - 0.75rem)`;
  };
  return [
    ...(screens.length > 1 || (screens[0]?.states.length ?? 0) > 1
      ? [
          {
            id: "screen",
            label: wording.preview.screen,
            // An icon, not the screen's name: the bar stands up the pane's edge, where a name
            // would widen it. The menu ticks the screen shown.
            icon: <PanelsTopLeft size={16} aria-hidden="true" />,
            menu: (
              <div className={styles.screenMenu} ref={fitPane}>
                {screens.map((entry) => (
                  <MenuGroup
                    key={entry.screen}
                    className={styles.screenColumn}
                    aria-label={spoken(entry.screen)}
                  >
                    <MenuLabel aria-hidden="true">
                      {spoken(entry.screen)}
                    </MenuLabel>
                    {(entry.states.length === 0 ? [null] : entry.states).map(
                      (state) => (
                        <MenuItem
                          key={String(state)}
                          onSelect={() => goto(stateHash(entry.screen, state))}
                        >
                          <MenuItemLabel>
                            {stateName(state)}
                            {entry === current && shown?.state === state ? (
                              <Check size={14} aria-label="Shown" />
                            ) : null}
                          </MenuItemLabel>
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
            icon: <Layers size={16} aria-hidden="true" />,
            row: current.states.map((state) => ({
              id: `state:${state}`,
              label: stateName(state),
              text: stateName(state),
              active: shown?.state === state,
              onSelect: () => goto(stateHash(current.screen, state)),
            })),
          },
        ]
      : []),
  ];
}

export type MockupFrameViewProps = {
  files: DesignFiles;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  /** Pane bar groups before the mockup's own screens (the draft's badge). */
  leading?: readonly PaneBarGroup[];
  trailing?: readonly PaneBarGroup[];
  /** Fills its container edge to edge, as a pane's whole page. */
  fill?: boolean;
  /** The look panel the bar's palette opens over the page, drawn around the frame's live tweaks. */
  tweakPanel: (panel: TweakPanelProps) => ReactNode;
};

/**
 * The bundle in a frame whose links move between the bundle's own screens. The expanded view
 * opens on the screen the person reached, and closing it brings the inline frame there too.
 */
export function MockupFrameView({
  files,
  device,
  onDevice,
  leading = [],
  trailing = [],
  fill = false,
  tweakPanel,
}: MockupFrameViewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const expandedFrame = useRef<HTMLIFrameElement>(null);
  const screen = useRef<MockupScreen>({ page: INDEX_PAGE, hash: "" });
  const [visit, setVisit] = useState<MockupScreen>(screen.current);
  const [expandedVisit, setExpandedVisit] = useState<MockupScreen | null>(null);
  const [screens, setScreens] = useState<FrameScreens>([]);
  const [themed, setThemed] = useState(false);
  const [shown, setShown] = useState<FrameShown | null>(null);
  const [tweaks, setTweaks] = useState<LookTweaks>({});
  const [tweaking, setTweaking] = useState(false);
  const tweakSheet = useRef("");
  tweakSheet.current = tweakCss(tweaks);
  useEffect(() => {
    const message = { designTweaks: tweakSheet.current };
    frame.current?.contentWindow?.postMessage(message, "*");
    expandedFrame.current?.contentWindow?.postMessage(message, "*");
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
      const listed = fromFrame(FrameScreens, data?.designScreens);
      if (inline && listed !== null) {
        setScreens(listed);
        setThemed(data?.designTheme === true);
        return;
      }
      const hash = data?.designScreen;
      if (typeof hash !== "string" || hash.length > MAX_SCREEN_CHARS) return;
      if (inline) setShown(fromFrame(FrameShown, data?.designShown));
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
  const screenGroup: PaneBarGroup = [
    ...screenActions(
      screens,
      shown,
      (hash) => tell({ designGoto: hash }),
      () => frame.current?.closest('[data-slot="device-preview"]'),
    ),
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
      fill={fill}
      overlay={
        tweaking
          ? tweakPanel({
              look,
              tweaks,
              onChange: setTweaks,
              onClose: closeTweaks,
            })
          : null
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

export type DesignPreviewViewProps = {
  /** The design's files by path; null when the design cannot be read. */
  files: DesignFiles | null;
  part: DesignPart;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  trailing?: readonly PaneBarGroup[];
  /** The mockup fills its container edge to edge, as a pane's whole page. */
  fill?: boolean;
  tweakPanel: (panel: TweakPanelProps) => ReactNode;
};

// The written plan as the document page reads it: without the file's front matter (its settings
// block).
export const planPage = (notes: string) =>
  notes.replace(/^\s*---\n[\s\S]*?\n---\n+/, "");

export function DesignPreviewView({
  files,
  part,
  device,
  onDevice,
  trailing = [],
  fill = false,
  tweakPanel,
}: DesignPreviewViewProps) {
  if (!files || files[`designs/${INDEX_PAGE}`] === undefined)
    return <InlineNote>This design cannot be shown.</InlineNote>;
  if (part === "mockup")
    return (
      <MockupFrameView
        files={files}
        device={device}
        onDevice={onDevice}
        trailing={trailing}
        fill={fill}
        tweakPanel={tweakPanel}
      />
    );
  // A written plan opens on the document page, so a plan reaches here only when there is none.
  return <InlineNote>{wording.design.noPlan}</InlineNote>;
}
