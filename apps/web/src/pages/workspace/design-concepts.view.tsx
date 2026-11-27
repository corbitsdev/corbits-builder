/** Design concepts as the person compares them: each concept's filed design. */
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { wording } from "../../config.ts";
import type { DesignFiles } from "./design-bundle.ts";
import { DesignPreviewView } from "./design-preview.view.tsx";
import type { PreviewDevice } from "./device-preview.tsx";
import type { TweakPanelProps } from "./mockup-tweaks.view.tsx";
import { PaneBarTip, type PaneBarGroup } from "./pane-bar.tsx";

export type ConceptMockupViewProps = {
  /** The concept's art direction, behind the bar's info tip. */
  direction: string | undefined;
  /** The concept's filed design, null when it cannot be read. */
  files: DesignFiles | null;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  tweakPanel: (panel: TweakPanelProps) => ReactNode;
};

/** A concept's filed design. */
export function ConceptMockupView({
  direction,
  files,
  device,
  onDevice,
  tweakPanel,
}: ConceptMockupViewProps) {
  const bar: readonly PaneBarGroup[] =
    direction === undefined
      ? []
      : [
          [
            {
              id: "direction",
              label: wording.design.conceptDirection,
              icon: <Info size={16} aria-hidden="true" />,
              menu: <PaneBarTip>{direction}</PaneBarTip>,
            },
          ],
        ];
  return (
    <DesignPreviewView
      files={files}
      part="mockup"
      device={device}
      onDevice={onDevice}
      trailing={bar}
      fill
      tweakPanel={tweakPanel}
    />
  );
}
