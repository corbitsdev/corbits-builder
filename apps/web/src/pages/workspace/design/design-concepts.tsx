/**
 * Design concepts the person compares before choosing one. `design-concepts.view.tsx` draws the
 * concept. A look saved from a concept's mockup goes into that concept's design.
 */
import { parseBundle } from "./design-bundle.ts";
import type { DesignConcept } from "./design-concept.ts";
import { ConceptMockupView } from "./design-concepts.view.tsx";
import type { PreviewDevice } from "./device-preview.tsx";
import { TweakPanel } from "./mockup-tweaks.tsx";

export function ConceptMockup({
  projectId,
  concept,
  device,
  onDevice,
}: {
  projectId: string;
  concept: DesignConcept;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
}) {
  const design = { projectId, concept: concept.label };
  return (
    <ConceptMockupView
      direction={concept.direction}
      files={parseBundle(concept.content)}
      device={device}
      onDevice={onDevice}
      tweakPanel={(panel) => <TweakPanel {...panel} design={design} />}
    />
  );
}
