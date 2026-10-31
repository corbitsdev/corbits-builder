/**
 * Design concepts the person compares before choosing one: each concept's designer files a
 * design_option titled by the concept, and its live draft shows until that option is filed. A
 * concept named after a design theme starts from that theme's sample app, so its draft shows only
 * once the designer has changed a page of it.
 */
import { useState, type CSSProperties } from "react";
import { Badge, Button } from "@corbits/react-ui";
import { MenuLabel } from "@corbits/react-ui/ui/menu";
import { Info } from "lucide-react";
import { toast } from "sonner";
import type { ProjectArtifact } from "@corbits-builder/client";
import type { InFlightRun } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import { chooseDesign } from "../../api/artifacts.ts";
import { humanFault } from "./human-fault.ts";
import {
  DesignPreview,
  draftBadge,
  MockupFrame,
  useDesignDraft,
  type DesignFiles,
} from "./design-preview.tsx";
import { useDesignThemes, useThemeFiles } from "./design-themes.tsx";
import { clock, useElapsedMs } from "./elapsed.tsx";
import { DesignTarget, mockupLook } from "./mockup-tweaks.tsx";
import type { PreviewDevice } from "./device-preview.tsx";
import type { PaneBarGroup } from "./pane-bar.tsx";

export const DESIGN_OPTION = "design_option";
const CONCEPT_TAB = "concept:";

export type ConceptView = {
  readonly label: string;
  readonly direction?: string;
  /** The filed option's design bundle, once its designer filed one. */
  readonly content?: string;
  /** The filed option at the version the person sees, which they choose by. */
  readonly option?: { readonly artifactId: string; readonly version: number };
  /** The person chose this concept, and its option is the approved design. */
  readonly chosen?: boolean;
  /** When the concept's designer started, and whether it is mid-turn or parked waiting for mail. */
  readonly run?: { readonly startedAt: string; readonly working: boolean };
};

/** The pane tab, and the document id the conversation opens, for one concept. */
export const conceptTab = (label: string) => CONCEPT_TAB + label;
export const conceptOfTab = (id: string) =>
  id.startsWith(CONCEPT_TAB) ? id.slice(CONCEPT_TAB.length) : undefined;

/**
 * One view per concept with a filed option or a designer at work, in the order the person was
 * asked about them. Directions come only from the asks this room has seen.
 */
export function designConcepts(
  options: readonly ProjectArtifact[],
  inFlight: readonly InFlightRun[],
  asked: readonly { readonly label: string; readonly direction: string }[],
  content: (option: ProjectArtifact) => string | undefined,
  chosen?: string,
): ConceptView[] {
  const labels = new Set([
    ...asked.map((concept) => concept.label),
    ...options.map((option) => option.title),
    ...inFlight.flatMap((run) =>
      run.concept === undefined ? [] : [run.concept],
    ),
  ]);
  const live = new Set([
    ...options.map((option) => option.title),
    ...inFlight.map((run) => run.concept),
  ]);
  return [...labels]
    .filter((label) => live.has(label))
    .map((label) => {
      const direction = asked.find(
        (concept) => concept.label === label,
      )?.direction;
      const option = options.find((item) => item.title === label);
      const body = option === undefined ? undefined : content(option);
      const run = inFlight.find((item) => item.concept === label);
      return {
        label,
        ...(direction === undefined ? {} : { direction }),
        ...(run === undefined
          ? {}
          : {
              run: {
                startedAt: run.startedAt,
                working: run.state === "working",
              },
            }),
        ...(body === undefined || option === undefined
          ? {}
          : {
              content: body,
              option: {
                artifactId: option.artifactId,
                version: option.version,
              },
            }),
        ...(label === chosen ? { chosen: true } : {}),
      };
    });
}

/** A concept's filed option, else its designer's live draft. */
export function ConceptMockup({
  projectId,
  concept,
  device,
  onDevice,
  trailing,
}: {
  projectId: string;
  concept: ConceptView;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  trailing: readonly PaneBarGroup[];
}) {
  const draft = useDesignDraft(
    projectId,
    concept.content !== undefined,
    concept.label,
  );
  const seed = useConceptSeed(projectId, concept);
  const bar: readonly PaneBarGroup[] =
    concept.direction === undefined
      ? trailing
      : [
          [
            {
              id: "direction",
              label: wording.design.conceptDirection,
              icon: <Info size={16} aria-hidden="true" />,
              menu: (
                <MenuLabel className="pane-bar-tip">
                  {concept.direction}
                </MenuLabel>
              ),
            },
          ],
          ...trailing,
        ];
  if (concept.content !== undefined)
    return (
      <DesignTarget.Provider value={{ projectId, concept: concept.label }}>
        <DesignPreview
          content={concept.content}
          part="mockup"
          device={device}
          onDevice={onDevice}
          trailing={bar}
        />
      </DesignTarget.Provider>
    );
  if (
    draft === null ||
    seed.pending ||
    (seed.files !== undefined && showsSeed(draft, seed.files))
  )
    return <ConceptSketching concept={concept} look={seed.files} />;
  return (
    <DesignTarget.Provider value={{ projectId, concept: concept.label }}>
      <MockupFrame
        files={draft}
        device={device}
        onDevice={onDevice}
        leading={[draftBadge(concept.run?.working === true)]}
        trailing={bar}
      />
    </DesignTarget.Provider>
  );
}

const isPage = (path: string) =>
  path.startsWith("designs/") && path.endsWith(".html");

/** None of the draft's pages differ from the sample app it started from. */
const showsSeed = (draft: DesignFiles, seed: DesignFiles) =>
  Object.entries(draft).every(
    ([path, text]) => !isPage(path) || seed[path] === text,
  );

/**
 * The theme sample a concept named after a design theme starts from, the way the hub picks it.
 * Pending while the theme is still loading, so the sample never flashes as the person's draft.
 */
function useConceptSeed(projectId: string, concept: ConceptView) {
  const drafting = concept.content === undefined;
  const themes = useDesignThemes(projectId);
  const theme = drafting
    ? themes.data?.find(
        (item) =>
          item.label.toLowerCase() === concept.label.trim().toLowerCase(),
      )
    : undefined;
  const files = useThemeFiles(projectId, theme?.id);
  return {
    pending:
      drafting &&
      (themes.isPending || (theme !== undefined && files.isPending)),
    files: files.data,
  };
}

/** The running clock, mounted only while the designer is mid-turn. */
function SketchingClock({ since }: { since: string }) {
  const seconds = Math.floor(useElapsedMs(since) / 1_000);
  return (
    <span className="concept-sketching-clock" role="timer" aria-live="off">
      {wording.design.conceptSketchingElapsed(clock(seconds))}
    </span>
  );
}

/** An app's frame drawn as placeholder bars; it pulses unless its container is still. */
export const AppSketch = () => (
  <div className="concept-sketch" aria-hidden="true">
    <span className="concept-sketch-bar" />
    <span className="concept-sketch-title" />
    <span className="concept-sketch-line" />
    <span className="concept-sketch-line concept-sketch-line-short" />
    <span className="concept-sketch-cards">
      <span />
      <span />
      <span />
    </span>
  </div>
);

/**
 * A gentle sketch in the concept's own look until its designer drafts the person's app. It moves
 * and counts only while the designer is mid-turn; a designer parked between turns is not drafting.
 */
function ConceptSketching({
  concept,
  look,
}: {
  concept: ConceptView;
  look: DesignFiles | undefined;
}) {
  const { run } = concept;
  const tokens = look === undefined ? {} : mockupLook(look);
  const style = {
    ...(tokens.primary === undefined
      ? {}
      : { "--sketch-primary": tokens.primary }),
    ...(tokens.background === undefined
      ? {}
      : { "--sketch-background": tokens.background }),
    ...(tokens.radius === undefined
      ? {}
      : { "--sketch-radius": `${tokens.radius}rem` }),
    ...(tokens.font === undefined ? {} : { "--sketch-font": tokens.font }),
  } as CSSProperties;
  return (
    <div
      className="concept-sketching"
      data-state={run?.working ? "working" : "still"}
      style={style}
      role="status"
    >
      <AppSketch />
      {run === undefined ? null : (
        <p className="concept-sketching-lead">
          {run.working
            ? wording.design.conceptSketching(concept.label)
            : wording.design.conceptWaiting(concept.label)}
        </p>
      )}
      <p className="concept-sketching-note">
        {wording.design.conceptSketchingNote}
        {run?.working ? (
          <>
            {" "}
            <SketchingClock since={run.startedAt} />
          </>
        ) : null}
      </p>
      {concept.direction === undefined ? null : (
        <p className="concept-sketching-direction">{concept.direction}</p>
      )}
    </div>
  );
}

/** The design the person chose in the conversation, in place of the ask it answered. */
export const DesignChosen = ({ concept }: { concept: string }) => (
  <p className="design-choice">
    <Badge tone="success">{wording.design.chosen(concept)}</Badge>
  </p>
);

/**
 * The person's choice of a filed concept, asked in the conversation; the hub files it as the
 * approved design and tells the coordinator.
 */
export function DesignChoice({
  projectId,
  concepts,
  onShowConcept,
  onChosen,
}: {
  projectId: string;
  /** The concepts with a filed option, each confirmable. */
  concepts: readonly ConceptView[];
  onShowConcept: (tab: string) => void;
  onChosen: (concept: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const choose = async (concept: ConceptView) => {
    if (concept.option === undefined) return;
    setChoosing(true);
    try {
      const receipt = await chooseDesign(projectId, concept.option);
      onChosen(receipt.concept);
    } catch (cause) {
      toast.error(humanFault(cause, wording.design.chooseFailed));
    } finally {
      setChoosing(false);
    }
  };
  const [only] = concepts;
  if (concepts.length === 1 && only !== undefined)
    return (
      <div className="design-choice">
        <p>{wording.design.confirmOne}</p>
        <Button
          type="button"
          size="sm"
          disabled={choosing}
          onClick={() => void choose(only)}
        >
          {choosing ? wording.design.confirming : wording.design.confirm}
        </Button>
      </div>
    );
  return (
    <div className="design-choice">
      <p>{wording.design.confirmSeveral}</p>
      <ul className="design-choice-options">
        {concepts.map((concept) => (
          <li key={concept.label}>
            <Button
              type="button"
              variant="link"
              size="sm"
              title={concept.direction}
              onClick={() => onShowConcept(conceptTab(concept.label))}
            >
              {concept.label}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={choosing}
              aria-label={wording.design.confirmConcept(concept.label)}
              onClick={() => void choose(concept)}
            >
              {choosing ? wording.design.confirming : wording.design.confirm}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
