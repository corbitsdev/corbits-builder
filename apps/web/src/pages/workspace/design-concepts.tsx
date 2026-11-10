/**
 * Design concepts the person compares before choosing one. `design-concepts.model.ts` reads each
 * concept's draft and files the choice; `design-concepts.view.tsx` draws the concept and the
 * choice. A look saved from a concept's mockup goes into that concept's design.
 */
import {
  useConceptMockup,
  useDesignChoice,
  type ConceptMockupProps,
  type DesignChoiceProps,
} from "./design-concepts.model.ts";
import {
  ConceptMockupView,
  DesignChoiceView,
} from "./design-concepts.view.tsx";
import { TweakPanel } from "./mockup-tweaks.tsx";

export function ConceptMockup(props: ConceptMockupProps) {
  const design = { projectId: props.projectId, concept: props.concept.label };
  return (
    <ConceptMockupView
      {...useConceptMockup(props)}
      tweakPanel={(panel) => <TweakPanel {...panel} design={design} />}
    />
  );
}

export function DesignChoice(props: DesignChoiceProps) {
  return <DesignChoiceView {...useDesignChoice(props)} />;
}
