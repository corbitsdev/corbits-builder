/**
 * Saving a mockup's live look tweaks. Nothing changes in the design until the person saves them:
 * the hub writes them into the design's own stylesheet and tells the coordinator and the designer.
 * A save is never an approval.
 */
import { useState } from "react";
import { toast } from "sonner";
import { wording } from "../../config.ts";
import { saveDesignTweaks } from "../../api/artifacts.ts";
import { humanFault } from "./human-fault.ts";
import { lookTokens } from "./mockup-look.ts";
import type {
  TweakPanelProps,
  TweakPanelViewProps,
} from "./mockup-tweaks.view.tsx";

/** The design a saved look goes into: the project's, or one design concept's. */
export type Design = { projectId: string; concept?: string };

export function useTweakPanel(
  panel: TweakPanelProps,
  design: Design,
): TweakPanelViewProps {
  const [saving, setSaving] = useState(false);
  // The live tweaks stay applied after a save: they now match the design's own stylesheet.
  const save = async () => {
    setSaving(true);
    try {
      const receipt = await saveDesignTweaks(design.projectId, {
        tokens: lookTokens(panel.tweaks),
        ...(design.concept === undefined ? {} : { concept: design.concept }),
      });
      toast.success(wording.tweak.saved(receipt.updated));
      panel.onClose();
    } catch (cause) {
      toast.error(humanFault(cause, wording.tweak.saveFailed));
    } finally {
      setSaving(false);
    }
  };
  return { ...panel, onSave: () => void save(), saving };
}
