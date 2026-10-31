import { MenuItem, MenuLabel } from "@corbits/react-ui/ui/menu";
import { Lightbulb } from "lucide-react";
import { wording } from "../../config.ts";
import {
  useDocumentTips,
  writeDocumentTips,
} from "../../document-tips-setting.ts";
import { useReducedMotion } from "../../reduced-motion.ts";
import { useElapsedMs } from "./elapsed.tsx";
import type { PaneBarGroup } from "./pane-bar.tsx";

const TIP_MS = 8_000;

// Ticks only while the menu is open, so the pane does not re-render every second.
function RotatingTip() {
  const still = useReducedMotion();
  const elapsed = useElapsedMs();
  const tips = wording.tips.items;
  const index = still ? 0 : Math.floor(elapsed / TIP_MS) % tips.length;
  return (
    <MenuLabel key={index} className="pane-bar-tip">
      {tips[index]}
    </MenuLabel>
  );
}

/** The tips as the pane bar's last group: an icon that opens one short tip at a time. */
export function useTipsGroup(): PaneBarGroup {
  if (useDocumentTips() === "off") return [];
  return [
    {
      id: "tips",
      label: wording.tips.label,
      icon: <Lightbulb size={16} aria-hidden="true" />,
      menu: (
        <>
          <RotatingTip />
          <MenuItem onSelect={() => writeDocumentTips("off")}>
            {wording.tips.turnOff}
          </MenuItem>
        </>
      ),
    },
  ];
}
