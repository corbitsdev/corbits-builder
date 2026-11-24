/**
 * A design bundle in the same sandboxed frame the design pane uses, for a plugin's screen: it
 * passes back the page's screens, the screen shown, the places tagged and the pins pressed, each
 * checked first, and takes a screen to show, whether a click tags a place and the pins to draw.
 * Given a bar, it is the design pane's own preview: the page filled, its floating bar beside it.
 */
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  FrameScreens,
  FrameShown,
  FrameSpot,
  FrameTag,
  type FramePin,
  fromFrame,
  INDEX_PAGE,
  MAX_SCREEN_CHARS,
  screenPage,
  type DesignFiles,
  type MockupScreen,
} from "./design-bundle.ts";
import { screenActions } from "./design-preview.view.tsx";
import { DevicePreview, type PreviewDevice } from "./device-preview.tsx";
import { GuiFrame } from "./gui-frame.tsx";
import type { PaneBarAction } from "./pane-bar.tsx";
import styles from "./mockup-frame.module.css";

export type MockupFrameHandle = { go(place: FrameShown): void };

export type MockupFrameProps = {
  files: DesignFiles;
  device: PreviewDevice;
  tagging: boolean;
  onScreens(screens: FrameScreens): void;
  onShown(shown: FrameShown | null): void;
  onTag(tag: FrameTag, spot: FrameSpot): void;
  pins?: readonly FramePin[];
  onPin?(pin: number): void;
  ref?: Ref<MockupFrameHandle>;
  /**
   * The design pane's floating bar, for a screen that fills the page: the mockup's screens, the
   * device and expand, then the screen's own actions, and a panel they lay over the page.
   */
  bar?:
    | {
        onDevice(device: PreviewDevice): void;
        actions: readonly PaneBarAction[];
        overlay?: ReactNode;
      }
    | undefined;
};

const NO_PINS: readonly FramePin[] = [];

const stateHash = ({ screen, state }: FrameShown) =>
  state === null ? `#/${screen}` : `#/${screen}/${state}`;

export function MockupFrame({
  files,
  device,
  tagging,
  onScreens,
  onShown,
  onTag,
  pins = NO_PINS,
  onPin,
  ref,
  bar,
}: MockupFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const screen = useRef<MockupScreen>({ page: INDEX_PAGE, hash: "" });
  const [visit, setVisit] = useState(screen.current);
  // Kept for the bar's screen menu; the screen's own handlers hear the same.
  const [screens, setScreens] = useState<FrameScreens>([]);
  const [shown, setShown] = useState<FrameShown | null>(null);
  // Read by the listener, so a new handler from the view does not resubscribe it.
  const latest = useRef({ tagging, pins, onScreens, onShown, onTag, onPin });
  latest.current = { tagging, pins, onScreens, onShown, onTag, onPin };
  const tell = (message: object) =>
    frame.current?.contentWindow?.postMessage(message, "*");
  useImperativeHandle(ref, () => ({
    go: (place) => tell({ designGoto: stateHash(place) }),
  }));
  useEffect(() => {
    tell({ designTagging: tagging });
  }, [tagging]);
  useEffect(() => {
    tell({ designPins: pins });
  }, [pins]);
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      const source = frame.current?.contentWindow;
      const data: unknown = event.data;
      if (!source || event.source !== source) return;
      if (typeof data !== "object" || data === null) return;
      const heard = latest.current;
      if ("designScreens" in data) {
        const listed = fromFrame(FrameScreens, data.designScreens);
        if (listed === null) return;
        setScreens(listed);
        heard.onScreens(listed);
        // Every load is a fresh page, which starts with tagging off and no pins.
        source.postMessage({ designTagging: heard.tagging }, "*");
        source.postMessage({ designPins: heard.pins }, "*");
        return;
      }
      if ("designTag" in data) {
        const tag = fromFrame(FrameTag, data.designTag);
        const spot =
          "designSpot" in data ? fromFrame(FrameSpot, data.designSpot) : null;
        if (tag !== null && spot !== null) heard.onTag(tag, spot);
        return;
      }
      if ("designPin" in data) {
        const pin = data.designPin;
        if (typeof pin === "number" && Number.isInteger(pin))
          heard.onPin?.(pin);
        return;
      }
      if (!("designScreen" in data)) return;
      const hash = data.designScreen;
      if (typeof hash !== "string" || hash.length > MAX_SCREEN_CHARS) return;
      const reached =
        "designShown" in data ? fromFrame(FrameShown, data.designShown) : null;
      setShown(reached);
      heard.onShown(reached);
      const page = "designPage" in data ? data.designPage : undefined;
      if (typeof page !== "string") {
        screen.current = { page: screen.current.page, hash };
        return;
      }
      screen.current = { page, hash };
      setVisit(screen.current);
    };
    window.addEventListener("message", hear);
    return () => window.removeEventListener("message", hear);
  }, []);
  // Rebuilt on the screen the person reached when the files change or a link opens another page.
  const html = useMemo(() => screenPage(files, screen.current), [files, visit]);
  if (bar === undefined)
    return (
      <div className={styles.frame} data-device={device}>
        <GuiFrame html={html} scripts fill frameRef={frame} />
      </div>
    );
  const listed = screenActions(
    screens,
    shown,
    (hash) => tell({ designGoto: hash }),
    () => frame.current?.closest('[data-slot="device-preview"]'),
  );
  return (
    <DevicePreview
      html={html}
      scripts
      frameRef={frame}
      device={device}
      onDevice={bar.onDevice}
      fill
      leading={listed.length === 0 ? [] : [listed]}
      trailing={bar.actions.length === 0 ? [] : [bar.actions]}
      overlay={bar.overlay}
    />
  );
}
