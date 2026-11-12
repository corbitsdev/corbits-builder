/**
 * Design concepts the person compares before choosing one. `design-concepts.model.ts` reads each
 * concept's draft; `design-concepts.view.tsx` draws it. A look saved from a concept's mockup goes
 * into that concept's design.
 */
import {
  useConceptMockup,
  type ConceptMockupProps,
} from "./design-concepts.model.ts";
import { ConceptMockupView } from "./design-concepts.view.tsx";
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
