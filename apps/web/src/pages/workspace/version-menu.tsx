/**
 * Retained versions of one artifact, as the pane bar's version menu. Viewing and comparing do not
 * invent a stage, and a version is not shown as open until its text has been read.
 */
import { MenuItem, MenuSeparator } from "@corbits/react-ui/ui/menu";
import { Check, ChevronDown } from "lucide-react";
import { wording } from "../../config.ts";
import type { PaneBarGroup } from "./pane-bar.tsx";

export function versionGroup({
  versions,
  viewing,
  pending,
  canCompare,
  onView,
  onComparePrevious,
}: {
  versions: readonly { version: number }[];
  viewing: number;
  pending: boolean;
  /** False when no older version can be read for this one. */
  canCompare: boolean;
  onView: (version: number) => void;
  onComparePrevious: () => void;
}): PaneBarGroup {
  if (versions.length < 2 && !canCompare) return [];
  const ordered = [...versions].sort(
    (left, right) => right.version - left.version,
  );
  return [
    {
      id: "version",
      label: wording.versions.menu(viewing),
      text: `v${String(viewing)}`,
      icon: <ChevronDown size={12} aria-hidden="true" />,
      disabled: pending,
      menu: (
        <>
          {ordered.map((item) => (
            <MenuItem key={item.version} onSelect={() => onView(item.version)}>
              <span className="version-menu-item">
                v{String(item.version)}
                {item.version === viewing ? (
                  <Check size={14} aria-label="Shown" />
                ) : null}
              </span>
            </MenuItem>
          ))}
          {canCompare ? (
            <>
              {ordered.length > 0 ? <MenuSeparator /> : null}
              <MenuItem onSelect={onComparePrevious}>
                {wording.versions.comparePrevious}
              </MenuItem>
            </>
          ) : null}
        </>
      ),
    },
  ];
}
