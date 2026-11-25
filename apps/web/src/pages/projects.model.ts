/**
 * The New project page's logic: starting a project and the two imports. The
 * opening sentence typed into the composer is not a stored artifact: it
 * becomes the project's first conversation message once the coordinator
 * binds, which the workspace sends on arrival.
 */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import type { ProjectImport } from "@corbits-builder/schemas/project-import";
import {
  DOCUMENT_LABELS,
  type RepositoryImport,
  type SuggestedReason,
} from "@corbits-builder/schemas/repository-import";
import { wording } from "../config.ts";
import { ApiFailure, type ProjectSummary } from "../api/types.ts";
import {
  createProject,
  importProject,
  readImportFile,
} from "../api/projects.ts";
import {
  canPickDirectory,
  describeBytes,
  listedDirectory,
  pickDirectory,
  readDirectory,
  type PickedDirectory,
} from "../api/repository.ts";
import { ROOM_NARROW_QUERY, useSidebar } from "../sidebar-setting.ts";
import { composerKey, moveUnsent, useUnsent } from "../unsent.ts";
import { canStartProject } from "./home-view.ts";
import { useNewProjectProfiles } from "./new-project-profiles.model.ts";
import type { AddProviderDialogProps } from "./settings/add-provider-dialog.model.ts";
import type { SettingsTab } from "./settings/settings.view.tsx";
import type { FolderReading, ProjectsViewProps } from "./projects.view.tsx";
import { useCoverPages } from "./project-cover.model.ts";
import { libraryProject } from "./project-library.model.ts";

export type ProjectsProps = {
  onOpen: (projectId: string, openingMessage?: string) => void;
  onChanged: () => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  /** No model provider holds a usable key, so a project cannot start yet. */
  needsProvider: boolean;
  /** Every project the person can see; the ones last worked on show as cards under the prompt. */
  projects: readonly ProjectSummary[];
  /** Opens the Projects page, where every project is. */
  onOpenLibrary: () => void;
};

/** How many of the projects last worked on show as cards under the prompt. */
const RECENT_CARDS = 4;

// Kept apart from every project's own box, since the project does not exist yet; a start that
// fails leaves it here for the next.
const STARTING_KEY = "unsent:composer:starting";

// A folder read as a project, with the files the reading suggests leaving out, ticked from the
// start, which the person can keep.
type PendingRepository = {
  picked: PickedDirectory;
  reading: RepositoryImport;
  choices: Map<string, SuggestedReason>;
  excluded: Set<string>;
};

function repositoryChoices(
  previous: PendingRepository["choices"],
  { report }: RepositoryImport,
): PendingRepository["choices"] {
  const choices = new Map(previous);
  for (const { path, reason } of report.suggested) choices.set(path, reason);
  return choices;
}

const documentNames = (kinds: readonly string[]) =>
  kinds
    .filter((kind) => kind !== "app")
    .map((kind) => DOCUMENT_LABELS[kind as keyof typeof DOCUMENT_LABELS]);

/** What the page says about a folder it has read. */
export function folderReading({
  picked,
  reading: { report, file },
  choices,
  excluded,
}: PendingRepository): FolderReading {
  return {
    title: report.title,
    folderName: picked.name,
    code: report.app
      ? { files: report.app.files, size: describeBytes(report.app.bytes) }
      : null,
    found: documentNames(file.documents.map((document) => document.kind)),
    toWrite: documentNames(report.missing),
    empty: file.documents.length === 0,
    warnings: report.warnings,
    leaveOut: [...choices].map(([path, reason]) => ({
      path,
      reason: wording.importProject.folderReasons[reason],
      leftOut: excluded.has(path),
    })),
  };
}

const failure = (cause: unknown) =>
  cause instanceof ApiFailure ? cause.detail.message : String(cause);

export function useProjects({
  onOpen,
  onChanged,
  onOpenSettings,
  needsProvider,
  projects,
  onOpenLibrary,
}: ProjectsProps): {
  view: ProjectsViewProps;
  /** The dialog the page's offer to connect a provider opens. */
  providerDialog: AddProviderDialogProps;
} {
  const [idea, setIdea] = useState("");
  // What the person types into the room while it starts, until the project it belongs to exists.
  const [followUp, setFollowUp] = useUnsent(STARTING_KEY);
  const [activity, setActivity] =
    useState<ProjectsViewProps["activity"]>("idle");
  const sidebar = useSidebar(ROOM_NARROW_QUERY);
  const [connecting, setConnecting] = useState(false);
  // A new project starts on the preferred profile until the person picks another.
  const profiles = useNewProjectProfiles();
  const [picked, setPicked] = useState<string>();
  const profile = picked ?? profiles.preferred;
  const recent = projects
    .filter((project) => project.archivedAt === null)
    .toSorted((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, RECENT_CARDS);
  const covers = useCoverPages(
    recent.map((project) => project.id),
    true,
  );

  // The start the starting room stands for. Leaving the room lets it go: the project is still
  // made, and listed, but the person is not taken into it.
  const shownStart = useRef<symbol | null>(null);
  useEffect(
    () => () => {
      shownStart.current = null;
    },
    [],
  );
  const leaveStart = () => {
    shownStart.current = null;
    setIdea("");
    setActivity("idle");
  };

  const start = async () => {
    if (activity !== "idle") return;
    if (!canStartProject(idea)) {
      toast.error(wording.message.projectEmpty);
      return;
    }
    // The page turns into the room as it goes, the box gliding to the foot, where the browser can
    // carry it across and the person has not asked for less motion.
    const glide =
      typeof document.startViewTransition === "function" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (glide)
      document.startViewTransition(() =>
        flushSync(() => setActivity("starting")),
      );
    else setActivity("starting");
    const shown = Symbol("start");
    shownStart.current = shown;
    const opening = idea.trim();
    try {
      const created = await createProject({
        problemStatement: opening,
        ...(profile === undefined ? {} : { profile }),
      });
      moveUnsent(STARTING_KEY, composerKey(created.projectId));
      onChanged();
      if (shownStart.current !== shown) return;
      setIdea("");
      // The hub mailed the opening sentence to the coordinator; the workspace
      // shows it until the conversation records it.
      onOpen(created.projectId, opening);
    } catch (cause) {
      toast.error(failure(cause));
      // Left before it failed, the idea goes back in the box, unless something new is there.
      if (shownStart.current !== shown)
        setIdea((now) => (now === "" ? opening : now));
    } finally {
      if (shownStart.current === shown) {
        shownStart.current = null;
        setActivity("idle");
      }
    }
  };

  // A file can mark documents approved; importing records the person's own approval of them, so
  // they see exactly which ones before anything is written.
  const [pendingImport, setPendingImport] = useState<{
    name: string;
    body: ProjectImport;
  } | null>(null);
  const [pendingRepository, setPendingRepository] =
    useState<PendingRepository | null>(null);

  const importFile = async (
    name: string,
    { file, omitted }: ProjectImport,
    withApprovals: boolean,
  ) => {
    setPendingImport(null);
    const importing = toast.loading(`Importing ${name}…`);
    setActivity("importing");
    try {
      const created = await importProject({
        file: withApprovals
          ? file
          : {
              ...file,
              documents: file.documents.map((document) => ({
                ...document,
                approved: false,
              })),
            },
        ...(profile === undefined ? {} : { profile }),
      });
      toast.success(`Imported ${name}.`, {
        id: importing,
        ...(omitted.length > 0
          ? { description: wording.importProject.omitted(omitted) }
          : {}),
      });
      onChanged();
      onOpen(created.projectId);
    } catch (cause) {
      toast.error(failure(cause), { id: importing });
    } finally {
      setActivity("idle");
    }
  };
  const chooseImport = async (file: File) => {
    try {
      const body = await readImportFile(file);
      if (body.file.documents.some((document) => document.approved))
        setPendingImport({ name: file.name, body });
      else await importFile(file.name, body, true);
    } catch (cause) {
      toast.error(failure(cause));
    }
  };

  // The folder is read in the browser and shown before anything is created; a file the reading
  // suggests leaving out starts out left out, and the person can leave out more until the code fits.
  const readFolder = async (
    folder: PickedDirectory,
    excluded: Set<string>,
    choices: PendingRepository["choices"],
  ) => {
    const reading = await readDirectory(folder, excluded);
    const next = repositoryChoices(choices, reading);
    const fresh = reading.report.suggested
      .map(({ path }) => path)
      .filter((path) => !choices.has(path));
    if (fresh.length > 0)
      return readFolder(folder, new Set([...excluded, ...fresh]), next);
    setPendingRepository({ picked: folder, reading, choices: next, excluded });
  };
  const chooseFolder = async (folder: PickedDirectory | undefined) => {
    if (!folder) return;
    setPendingImport(null);
    setActivity("importing");
    try {
      await readFolder(folder, new Set(), new Map());
    } catch (cause) {
      toast.error(failure(cause));
    } finally {
      setActivity("idle");
    }
  };
  const pickFolder = async () => chooseFolder(await pickDirectory());
  const leaveOut = async (path: string, leftOut: boolean) => {
    if (!pendingRepository) return;
    const next = new Set(pendingRepository.excluded);
    if (leftOut) next.add(path);
    else next.delete(path);
    setActivity("importing");
    try {
      await readFolder(
        pendingRepository.picked,
        next,
        pendingRepository.choices,
      );
    } catch (cause) {
      toast.error(failure(cause));
    } finally {
      setActivity("idle");
    }
  };

  return {
    view: {
      activity,
      sidebar: {
        open: sidebar.open,
        drawer: sidebar.drawer,
        onToggleSidebar: sidebar.toggle,
        onHome: leaveStart,
        onPreferences: () => {
          leaveStart();
          onOpenSettings("preferences");
        },
      },
      idea,
      onIdeaChange: setIdea,
      followUp,
      onFollowUpChange: setFollowUp,
      onStart: () => void start(),
      profiles: profiles.options,
      profile,
      onProfileChange: setPicked,
      needsProvider,
      recent: recent.map((project, index) =>
        libraryProject(project, covers.pages[index]!),
      ),
      onCoverNear: covers.onNear,
      onOpenLibrary,
      onOpenProject: (projectId) => onOpen(projectId),
      onConnectProvider: () => setConnecting(true),
      onImportFile: (file) => void chooseImport(file),
      onPickFolder: canPickDirectory() ? () => void pickFolder() : null,
      onImportFolderFiles: (files) => void chooseFolder(listedDirectory(files)),
      approvals:
        pendingImport === null
          ? null
          : {
              fileName: pendingImport.name,
              documents: pendingImport.body.file.documents
                .filter((document) => document.approved)
                .map((document) => document.title),
              onImport: (approve) =>
                void importFile(
                  pendingImport.name,
                  pendingImport.body,
                  approve,
                ),
              onCancel: () => setPendingImport(null),
            },
      folder:
        pendingRepository === null
          ? null
          : {
              reading: folderReading(pendingRepository),
              onLeaveOut: (path, leftOut) => void leaveOut(path, leftOut),
              onImport: () =>
                void importFile(
                  pendingRepository.picked.name,
                  { file: pendingRepository.reading.file, omitted: [] },
                  false,
                ),
              onCancel: () => setPendingRepository(null),
            },
    },
    providerDialog: {
      open: connecting,
      onOpenChange: setConnecting,
      onConnected: onChanged,
    },
  };
}
