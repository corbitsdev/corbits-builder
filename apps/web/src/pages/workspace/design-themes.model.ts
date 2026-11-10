/**
 * The design themes as the hub lists them, each with the example app it reads whole by the
 * theme's id. Using a theme puts a message in the composer asking for the app in that theme with
 * the person's tweaks, so the coordinator designs that one concept instead of several.
 */
import {
  queryOptions,
  skipToken,
  useQueries,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useState } from "react";
import type { DesignThemeList } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import { keys } from "../../queries/keys.ts";
import { listDesignThemes, readDesignTheme } from "../../api/design-themes.ts";
import { firstPage, type DesignFiles } from "./design-bundle.ts";
import type {
  DesignThemesViewProps,
  OpenedTheme,
} from "./design-themes.view.tsx";
import type { LookTweaks } from "./mockup-look.ts";

export type DesignThemesProps = {
  projectId: string;
  onUse: (message: string) => void;
};

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

const themeFilesQuery = (projectId: string, themeId: string | undefined) =>
  queryOptions({
    queryKey: keys.designThemes.theme(projectId, themeId),
    queryFn:
      themeId === undefined
        ? skipToken
        : () => readDesignTheme(projectId, themeId),
    staleTime: Infinity,
  });

export function useThemeFiles(projectId: string, themeId: string | undefined) {
  return useQuery(themeFilesQuery(projectId, themeId));
}

type Listed = {
  theme: DesignThemeList["themes"][number];
  example: UseQueryResult<DesignFiles>;
};

function gallery(
  failed: boolean,
  listed: readonly Listed[] | undefined,
): DesignThemesViewProps["themes"] {
  if (failed) return "failed";
  if (listed === undefined) return "loading";
  return listed.map(({ theme, example }) => ({
    id: theme.id,
    name: theme.label,
    direction: theme.direction,
    page: example.data === undefined ? null : firstPage(example.data),
  }));
}

function exampleOf(files: UseQueryResult<DesignFiles>): OpenedTheme["example"] {
  if (files.isError) return "failed";
  if (files.data === undefined) return "loading";
  return files.data;
}

export function useDesignThemesGallery({
  projectId,
  onUse,
}: DesignThemesProps): DesignThemesViewProps {
  const [openedId, setOpenedId] = useState<string | null>(null);
  const list = useDesignThemes(projectId);
  const examples = useQueries({
    queries:
      list.data === undefined
        ? []
        : list.data.map((theme) => themeFilesQuery(projectId, theme.id)),
  });
  // The examples come back in the order their themes were asked for.
  const listed = list.data?.map((theme, index): Listed => ({
    theme,
    example: examples[index]!,
  }));
  const opened = listed?.find(({ theme }) => theme.id === openedId);
  return {
    themes: gallery(list.isError, listed),
    opened:
      opened === undefined
        ? null
        : {
            id: opened.theme.id,
            name: opened.theme.label,
            example: exampleOf(opened.example),
            onUse: (tweaks) =>
              onUse(
                wording.themes.message(opened.theme.label, looksOf(tweaks)),
              ),
          },
    onOpen: setOpenedId,
    onBack: () => setOpenedId(null),
  };
}
