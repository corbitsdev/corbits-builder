/**
 * Live look tweaks over a designer's mockup: the frame is cross-origin, so the values go in as a
 * stylesheet message the page applies over its own tokens. `mockup-tweaks.model.ts` saves them
 * into the design and `mockup-tweaks.view.tsx` draws the panel.
 */
import { useTweakPanel, type Design } from "./mockup-tweaks.model.ts";
import { TweakPanelView, type TweakPanelProps } from "./mockup-tweaks.view.tsx";

export function TweakPanel({
  design,
  ...panel
}: TweakPanelProps & { design: Design }) {
  return <TweakPanelView {...useTweakPanel(panel, design)} />;
}
