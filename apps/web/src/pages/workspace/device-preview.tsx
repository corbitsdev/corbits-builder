/**
 * A size cue around the sandboxed page; scripts run only when asked, never with same-origin access.
 * With src, the page is the running app at its own origin instead.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import { Maximize2, Monitor, Smartphone } from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";
import { wording } from "../../config.ts";
import { AppFrame, GuiFrame } from "./gui-frame.tsx";
import { PaneBar, type PaneBarGroup } from "./pane-bar.tsx";

export type PreviewDevice = "desktop" | "phone";

export function DevicePreview({
  html = "",
  src,
  device,
  onDevice,
  scripts = false,
  frameRef,
  expandedHtml,
  expandedFrameRef,
  onExpandedChange,
  leading = [],
  trailing = [],
  overlay,
  popover,
  popoverRef,
}: {
  html?: string;
  src?: { url: string; title: string };
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  scripts?: boolean;
  frameRef?: Ref<HTMLIFrameElement>;
  /** The page the expanded view opens on, when it is not `html` (a mockup on another screen). */
  expandedHtml?: string | undefined;
  expandedFrameRef?: Ref<HTMLIFrameElement>;
  onExpandedChange?: (open: boolean) => void;
  /** Pane bar groups before and after the preview's own (a mockup's screens; versions, tips). */
  leading?: readonly PaneBarGroup[];
  trailing?: readonly PaneBarGroup[];
  /** A panel a bar action opens over the page, above the bar. */
  overlay?: ReactNode;
  /** A panel a bar action opens, anchored to the bar so it moves with it. */
  popover?: ReactNode;
  popoverRef?: Ref<HTMLDivElement> | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  if (src === undefined && html.trim().length === 0)
    return <GuiFrame html={html} />;
  const expand = (open: boolean) => {
    setExpanded(open);
    onExpandedChange?.(open);
  };
  return (
    <figure
      className={`device-preview device-preview-${device}`}
      aria-label="Device preview"
    >
      <div className="device-bezel">
        {src === undefined ? (
          <GuiFrame html={html} scripts={scripts} frameRef={frameRef} />
        ) : (
          <AppFrame src={src.url} title={src.title} />
        )}
      </div>
      {overlay}
      <PaneBar
        label={wording.preview.actions}
        floating
        popover={popover}
        popoverRef={popoverRef}
        groups={[
          ...leading,
          [
            {
              id: "desktop",
              label: wording.preview.desktop,
              icon: <Monitor size={16} aria-hidden="true" />,
              active: device === "desktop",
              onSelect: () => onDevice("desktop"),
            },
            {
              id: "phone",
              label: wording.preview.phone,
              icon: <Smartphone size={16} aria-hidden="true" />,
              active: device === "phone",
              onSelect: () => onDevice("phone"),
            },
          ],
          [
            {
              id: "expand",
              label: wording.preview.expand,
              icon: <Maximize2 size={16} aria-hidden="true" />,
              onSelect: () => expand(true),
            },
          ],
          ...trailing,
        ]}
      />
      <Dialog open={expanded} onOpenChange={expand}>
        <DialogContent className="device-preview-expanded">
          <DialogHeader>
            <DialogTitle>{wording.preview.expandedTitle}</DialogTitle>
          </DialogHeader>
          <div className={`device-bezel device-preview-${device}`}>
            {src === undefined ? (
              <GuiFrame
                html={expandedHtml ?? html}
                scripts={scripts}
                frameRef={expandedFrameRef}
              />
            ) : (
              <AppFrame src={src.url} title={src.title} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </figure>
  );
}
