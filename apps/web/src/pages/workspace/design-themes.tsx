/**
 * Prebuilt looks a person browses once the project reaches design: a gallery of each theme's
 * example mockup, and one theme opened to click through and tweak live. Using one puts a message in
 * the composer asking for the app in that theme with the person's tweaks, so the coordinator
 * designs that one concept instead of several.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import type { DesignThemeList } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import { keys } from "../../queries/keys.ts";
import { listDesignThemes, readDesignTheme } from "../../api/design-themes.ts";
import { firstPage, MockupFrame } from "./design-preview.tsx";
import type { PreviewDevice } from "./device-preview.tsx";
import { GuiFrame } from "./gui-frame.tsx";
import { DesignTarget, type LookTweaks } from "./mockup-tweaks.tsx";
import type { PaneBarGroup } from "./pane-bar.tsx";

type Theme = DesignThemeList["themes"][number];

function looksOf(tweaks: LookTweaks): string[] {
  const { looks } = wording.themes;
  return [
    ...(tweaks.primary === undefined ? [] : [looks.primary(tweaks.primary)]),
    ...(tweaks.background === undefined
      ? []
      : [looks.background(tweaks.background)]),
    ...(tweaks.radius === undefined ? [] : [looks.radius(tweaks.radius)]),
    ...(tweaks.font === undefined ? [] : [looks.font(tweaks.font)]),
  ];
}

export function useDesignThemes(projectId: string) {
  return useQuery({
    queryKey: keys.designThemes.of(projectId),
    queryFn: () => listDesignThemes(projectId),
    staleTime: Infinity,
  });
}

export function useThemeFiles(projectId: string, themeId: string | undefined) {
  return useQuery({
    queryKey: keys.designThemes.theme(projectId, themeId ?? ""),
    queryFn: () => readDesignTheme(projectId, themeId!),
    enabled: themeId !== undefined,
    staleTime: Infinity,
  });
}

function ThemeCard({
  projectId,
  theme,
  onOpen,
}: {
  projectId: string;
  theme: Theme;
  onOpen: () => void;
}) {
  const files = useThemeFiles(projectId, theme.id);
  return (
    <button
      type="button"
      className="design-theme-card"
      aria-label={wording.themes.open(theme.label)}
      onClick={onOpen}
    >
      {/* A still picture of the page: inert, so it neither takes focus nor eats the click. */}
      <span className="design-theme-thumb" aria-hidden="true" inert>
        {files.data === undefined ? null : (
          <GuiFrame html={firstPage(files.data)} scripts />
        )}
      </span>
      <span className="design-theme-name">{theme.label}</span>
      <span className="design-theme-direction" title={theme.direction}>
        {theme.direction}
      </span>
    </button>
  );
}

function ThemePreview({
  projectId,
  theme,
  onBack,
  onUse,
  trailing,
}: {
  projectId: string;
  theme: Theme;
  onBack: () => void;
  onUse: (message: string) => void;
  trailing: readonly PaneBarGroup[];
}) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [tweaks, setTweaks] = useState<LookTweaks>({});
  const files = useThemeFiles(projectId, theme.id);
  if (files.isError)
    return <p className="inline-note">{wording.themes.failed}</p>;
  if (files.data === undefined)
    return <p className="inline-note">{wording.themes.loading}</p>;
  return (
    <MockupFrame
      files={files.data}
      device={device}
      onDevice={setDevice}
      onTweaks={setTweaks}
      leading={[
        [
          {
            id: "theme-gallery",
            label: wording.themes.back,
            text: theme.label,
            icon: <ArrowLeft size={16} aria-hidden="true" />,
            onSelect: onBack,
          },
        ],
      ]}
      trailing={[
        [
          {
            id: "use-theme",
            label: wording.themes.use,
            text: wording.themes.use,
            icon: <MessageSquarePlus size={16} aria-hidden="true" />,
            onSelect: () =>
              onUse(wording.themes.message(theme.label, looksOf(tweaks))),
          },
        ],
        ...trailing,
      ]}
    />
  );
}

export function DesignThemes({
  projectId,
  onUse,
  trailing,
}: {
  projectId: string;
  onUse: (message: string) => void;
  trailing: readonly PaneBarGroup[];
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const themes = useDesignThemes(projectId);
  if (themes.isError)
    return <p className="inline-note">{wording.themes.failed}</p>;
  if (themes.data === undefined)
    return <p className="inline-note">{wording.themes.loading}</p>;
  const theme = themes.data.find((item) => item.id === opened);
  if (theme !== undefined)
    return (
      // No design to save tweaks into: they travel in the message instead.
      <DesignTarget.Provider value={null}>
        <ThemePreview
          key={theme.id}
          projectId={projectId}
          theme={theme}
          onBack={() => setOpened(null)}
          onUse={onUse}
          trailing={trailing}
        />
      </DesignTarget.Provider>
    );
  return (
    <div className="design-theme-gallery">
      <p className="design-theme-lead">{wording.themes.title}</p>
      <ul className="design-theme-grid" aria-label={wording.themes.gallery}>
        {themes.data.map((item) => (
          <li key={item.id}>
            <ThemeCard
              projectId={projectId}
              theme={item}
              onOpen={() => setOpened(item.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
