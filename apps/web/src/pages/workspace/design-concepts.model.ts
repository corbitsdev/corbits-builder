/**
 * Design concepts the person compares before choosing one: each concept's designer files a
 * design_option titled by the concept, and its live draft shows until that option is filed. A
 * concept named after a design theme starts from that theme's sample app, so its draft shows only
 * once the designer has changed a page of it.
 */
import { useState } from "react";
import { toast } from "sonner";
import type { ProjectArtifact } from "@corbits-builder/client";
import type { InFlightRun } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import { chooseDesign } from "../../api/artifacts.ts";
import { conceptTab, type DesignConcept } from "./design-concept.ts";
import { humanFault } from "./human-fault.ts";
import { parseBundle, type DesignFiles } from "./design-bundle.ts";
import type {
  ConceptMockupViewProps,
  DesignChoiceViewProps,
} from "./design-concepts.view.tsx";
import { useDesignDraft } from "./design-preview.model.ts";
import { useDesignThemes, useThemeFiles } from "./design-themes.model.ts";
import type { PreviewDevice } from "./device-preview.tsx";
import { mockupLook } from "./mockup-look.ts";

export const DESIGN_OPTION = "design_option";

/**
 * The concepts with a filed option or a designer at work, in the order the person was asked about
 * them. Directions come only from the asks this room has seen.
 */
export function designConcepts(
  options: readonly ProjectArtifact[],
  inFlight: readonly InFlightRun[],
  asked: readonly { readonly label: string; readonly direction: string }[],
  content: (option: ProjectArtifact) => string | undefined,
  chosen?: string,
): DesignConcept[] {
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

export type ConceptMockupProps = {
  projectId: string;
  concept: DesignConcept;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
};

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
function useConceptSeed(projectId: string, concept: DesignConcept) {
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

/** A concept's filed option, else its designer's live draft once it differs from its sample. */
export function useConceptMockup({
  projectId,
  concept,
  device,
  onDevice,
}: ConceptMockupProps): Omit<ConceptMockupViewProps, "tweakPanel"> {
  const draft = useDesignDraft(
    projectId,
    concept.content !== undefined,
    concept.label,
  );
  const seed = useConceptSeed(projectId, concept);
  const mockup = (): ConceptMockupViewProps["mockup"] => {
    if (concept.content !== undefined)
      return { state: "filed", files: parseBundle(concept.content) };
    if (
      draft === null ||
      seed.pending ||
      (seed.files !== undefined && showsSeed(draft, seed.files))
    )
      return {
        state: "sketching",
        look: seed.files === undefined ? {} : mockupLook(seed.files),
        designer: concept.run,
      };
    return {
      state: "draft",
      files: draft,
      working: concept.run?.working === true,
    };
  };
  return {
    label: concept.label,
    direction: concept.direction,
    mockup: mockup(),
    device,
    onDevice,
  };
}

export type DesignChoiceProps = {
  projectId: string;
  /** The concepts with a filed option, each confirmable. */
  concepts: readonly DesignConcept[];
  onShowConcept: (tab: string) => void;
  onChosen: (concept: string) => void;
};

/**
 * The person's choice of a filed concept, asked in the conversation; the hub files it as the
 * approved design and tells the coordinator.
 */
export function useDesignChoice({
  projectId,
  concepts,
  onShowConcept,
  onChosen,
}: DesignChoiceProps): DesignChoiceViewProps {
  const [choosing, setChoosing] = useState(false);
  const choose = async (label: string) => {
    const option = concepts.find((concept) => concept.label === label)?.option;
    if (option === undefined) return;
    setChoosing(true);
    try {
      const receipt = await chooseDesign(projectId, option);
      onChosen(receipt.concept);
    } catch (cause) {
      toast.error(humanFault(cause, wording.design.chooseFailed));
    } finally {
      setChoosing(false);
    }
  };
  return {
    concepts: concepts.map(({ label, direction }) => ({ label, direction })),
    choosing,
    onShow: (label) => onShowConcept(conceptTab(label)),
    onChoose: (label) => void choose(label),
  };
}
