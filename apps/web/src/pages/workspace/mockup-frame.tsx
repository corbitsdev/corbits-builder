/**
 * A design bundle in the same sandboxed frame the design pane uses, for a plugin's screen: it
 * passes back the page's screens, the screen shown and the places tagged, each checked first, and
 * takes a screen to show and whether a click tags a place.
 */
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  FrameScreens,
  FrameShown,
  FrameTag,
  fromFrame,
  INDEX_PAGE,
  MAX_SCREEN_CHARS,
  screenPage,
  type DesignFiles,
  type MockupScreen,
} from "./design-bundle.ts";
import type { PreviewDevice } from "./device-preview.tsx";
import { GuiFrame } from "./gui-frame.tsx";
import styles from "./mockup-frame.module.css";

export type MockupFrameHandle = { go(place: FrameShown): void };

export type MockupFrameProps = {
  files: DesignFiles;
  device: PreviewDevice;
  tagging: boolean;
  onScreens(screens: FrameScreens): void;
  onShown(shown: FrameShown | null): void;
  onTag(tag: FrameTag): void;
  ref?: Ref<MockupFrameHandle>;
};

const stateHash = ({ screen, state }: FrameShown) =>
  state === null ? `#/${screen}` : `#/${screen}/${state}`;

export function MockupFrame({
  files,
  device,
  tagging,
  onScreens,
  onShown,
  onTag,
  ref,
}: MockupFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const screen = useRef<MockupScreen>({ page: INDEX_PAGE, hash: "" });
  const [visit, setVisit] = useState(screen.current);
  // Read by the listener, so a new handler from the view does not resubscribe it.
  const latest = useRef({ tagging, onScreens, onShown, onTag });
  latest.current = { tagging, onScreens, onShown, onTag };
  const tell = (message: object) =>
    frame.current?.contentWindow?.postMessage(message, "*");
  useImperativeHandle(ref, () => ({
    go: (place) => tell({ designGoto: stateHash(place) }),
  }));
  useEffect(() => {
    tell({ designTagging: tagging });
  }, [tagging]);
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
        heard.onScreens(listed);
        // Every load is a fresh page, which starts with tagging off.
        source.postMessage({ designTagging: heard.tagging }, "*");
        return;
      }
      if ("designTag" in data) {
        const tag = fromFrame(FrameTag, data.designTag);
        if (tag !== null) heard.onTag(tag);
        return;
      }
      if (!("designScreen" in data)) return;
      const hash = data.designScreen;
      if (typeof hash !== "string" || hash.length > MAX_SCREEN_CHARS) return;
      heard.onShown(
        "designShown" in data ? fromFrame(FrameShown, data.designShown) : null,
      );
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
  return (
    <div className={styles.frame} data-device={device}>
      <GuiFrame html={html} scripts fill frameRef={frame} />
    </div>
  );
}
