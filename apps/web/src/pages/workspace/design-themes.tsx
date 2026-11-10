/**
 * Prebuilt looks a person browses once the project reaches design. `design-themes.model.ts` reads
 * the themes from the hub and `design-themes.view.tsx` draws the gallery and the opened theme.
 */
import {
  useDesignThemesGallery,
  type DesignThemesProps,
} from "./design-themes.model.ts";
import { DesignThemesView } from "./design-themes.view.tsx";

export function DesignThemes(props: DesignThemesProps) {
  return <DesignThemesView {...useDesignThemesGallery(props)} />;
}
