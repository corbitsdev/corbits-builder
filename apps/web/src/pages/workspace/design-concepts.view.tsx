/**
 * Design concepts as the person compares them: a concept's filed design or its designer's live
 * draft, and a sketch in the concept's own look until there is one to show.
 */
import type { CSSProperties, ReactNode } from "react";
import { Info } from "lucide-react";
import { wording } from "../../config.ts";
import type { DesignFiles } from "./design-bundle.ts";
import {
  DesignPreviewView,
  draftBadge,
  MockupFrameView,
} from "./design-preview.view.tsx";
import type { PreviewDevice } from "./device-preview.tsx";
import type { LookTweaks } from "./mockup-look.ts";
import type { TweakPanelProps } from "./mockup-tweaks.view.tsx";
import { PaneBarTip, type PaneBarGroup } from "./pane-bar.tsx";
import {
  Sketching,
  SketchingClock,
  SketchingLead,
  SketchingNote,
} from "./sketching.tsx";
import styles from "./design-concepts.module.css";

/** A concept's designer: when it started, and whether it is mid-turn or parked waiting for mail. */
type Designer = { readonly startedAt: string; readonly working: boolean };

type Sketch = {
  /** The look of the sample app the concept starts from, where it has one. */
  look: LookTweaks;
  designer: Designer | undefined;
};

export type ConceptMockupViewProps = {
  /** The concept's name. */
  label: string;
  /** The concept's art direction, behind the bar's info tip and under the sketch. */
  direction: string | undefined;
  /** What there is to show of the concept: its filed design, its designer's draft, or neither yet. */
  mockup:
    | { state: "filed"; files: DesignFiles | null }
    | { state: "draft"; files: DesignFiles; working: boolean }
    | ({ state: "sketching" } & Sketch);
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  tweakPanel: (panel: TweakPanelProps) => ReactNode;
};

/** A concept's filed option, else its designer's live draft. */
export function ConceptMockupView({
  label,
  direction,
  mockup,
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
  if (mockup.state === "filed")
    return (
      <DesignPreviewView
        files={mockup.files}
        part="mockup"
        device={device}
        onDevice={onDevice}
        trailing={bar}
        fill
        tweakPanel={tweakPanel}
      />
    );
  if (mockup.state === "sketching")
    return (
      <ConceptSketching
        label={label}
        direction={direction}
        look={mockup.look}
        designer={mockup.designer}
      />
    );
  return (
    <MockupFrameView
      files={mockup.files}
      device={device}
      onDevice={onDevice}
      leading={[draftBadge(mockup.working)]}
      trailing={bar}
      fill
      tweakPanel={tweakPanel}
    />
  );
}

/**
 * A gentle sketch in the concept's own look until its designer drafts the person's app. It moves
 * and counts only while the designer is mid-turn; a designer parked between turns is not drafting.
 */
function ConceptSketching({
  label,
  direction,
  look,
  designer,
}: Sketch & { label: string; direction: string | undefined }) {
  const style = {
    ...(look.primary === undefined ? {} : { "--sketch-primary": look.primary }),
    ...(look.background === undefined
      ? {}
      : { "--sketch-background": look.background }),
    ...(look.radius === undefined
      ? {}
      : { "--sketch-radius": `${look.radius}rem` }),
    ...(look.font === undefined ? {} : { "--sketch-font": look.font }),
  } as CSSProperties;
  return (
    <Sketching working={designer?.working === true} style={style}>
      {designer === undefined ? null : (
        <SketchingLead>
          {designer.working
            ? wording.design.conceptSketching(label)
            : wording.design.conceptWaiting(label)}
        </SketchingLead>
      )}
      <SketchingNote>
        {wording.design.conceptSketchingNote}
        {designer?.working ? (
          <>
            {" "}
            <SketchingClock
              since={designer.startedAt}
              label={wording.design.conceptSketchingElapsed}
            />
          </>
        ) : null}
      </SketchingNote>
      {direction === undefined ? null : (
        <p className={styles.direction}>{direction}</p>
      )}
    </Sketching>
  );
}
