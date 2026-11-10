/**
 * New project: the landing page. One prompt to start something; the
 * projects themselves are listed in the rail. The opening sentence typed
 * into the composer is not a stored artifact: it becomes the project's first
 * conversation message once the coordinator binds, which the workspace sends
 * on arrival.
 */
import { wording } from "../config.ts";
import { toast } from "sonner";
import {
  Checkbox,
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  ShimmerText,
} from "@corbits/react-ui";
import { useRef, useState } from "react";
import { ApiFailure } from "../api/types.ts";
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
import { Banner, BannerAction, Button } from "../components.jsx";
import { ConnectProvider } from "./settings/providers.jsx";
import { NewProjectProfile } from "./profile-select.jsx";
import { Dictated } from "../dictation.jsx";
import { useShellReply } from "../flourish.tsx";
import { Composer } from "../composer.tsx";
import { HOME_COMPOSER_PLACEHOLDER, canStartProject } from "./home-view.ts";
import styles from "./projects.module.css";
import type { ProjectImport } from "@corbits-builder/schemas/project-import";
import {
  DOCUMENT_LABELS,
  type RepositoryImport,
  type SuggestedReason,
} from "@corbits-builder/schemas/repository-import";

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

export function Projects({
  onOpen,
  onChanged,
  needsProvider,
}: {
  onOpen: (projectId: string, openingMessage?: string) => void;
  onChanged: () => void;
  /** No model provider holds a usable key, so a project cannot start yet. */
  needsProvider: boolean;
}) {
  const [problem, setProblem] = useState("");
  const [profile, setProfile] = useState<string>();
  const [busy, setBusy] = useState<"start" | "import" | null>(null);
  const starting = busy === "start";
  const shell = useShellReply(useRef<HTMLElement>(null));

  const start = async () => {
    if (busy !== null) return;
    if (shell.answers(problem)) return setProblem("");
    if (!canStartProject(problem)) {
      toast.error(wording.message.projectEmpty);
      return;
    }
    setBusy("start");
    try {
      const created = await createProject({
        problemStatement: problem.trim(),
        ...(profile === undefined ? {} : { profile }),
      });
      const opening = problem.trim();
      setProblem("");
      onChanged();
      // The hub mailed the opening sentence to the coordinator; the workspace
      // shows it until the conversation records it.
      onOpen(created.projectId, opening);
    } catch (cause) {
      toast.error(
        cause instanceof ApiFailure ? cause.detail.message : String(cause),
      );
    } finally {
      setBusy(null);
    }
  };

  const importInput = useRef<HTMLInputElement>(null);
  // A file can mark documents approved; importing records the person's own approval of them, so
  // they see exactly which ones before anything is written.
  const [pendingImport, setPendingImport] = useState<{
    name: string;
    body: ProjectImport;
  } | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [pendingRepository, setPendingRepository] =
    useState<PendingRepository | null>(null);
  const failImport = (name: string, cause: unknown, id?: string | number) =>
    toast.error(
      cause instanceof ApiFailure ? cause.detail.message : String(cause),
      id === undefined ? {} : { id },
    );
  const chooseImport = async (file: File) => {
    try {
      const body = await readImportFile(file);
      if (body.file.documents.some((document) => document.approved))
        setPendingImport({ name: file.name, body });
      else await importFile(file.name, body, true);
    } catch (cause) {
      failImport(file.name, cause);
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };
  // The folder is read in the browser and shown before anything is created; a file the reading
  // suggests leaving out starts out left out, and the person can leave out more until the code fits.
  const readFolder = async (
    picked: PickedDirectory,
    excluded: Set<string>,
    choices: PendingRepository["choices"],
  ) => {
    const reading = await readDirectory(picked, excluded);
    const next = repositoryChoices(choices, reading);
    const fresh = reading.report.suggested
      .map(({ path }) => path)
      .filter((path) => !choices.has(path));
    if (fresh.length > 0)
      return readFolder(picked, new Set([...excluded, ...fresh]), next);
    setPendingRepository({ picked, reading, choices: next, excluded });
  };
  const chooseFolder = async (picked: PickedDirectory | undefined) => {
    if (!picked) return;
    setPendingImport(null);
    setBusy("import");
    try {
      await readFolder(picked, new Set(), new Map());
    } catch (cause) {
      failImport(picked.name, cause);
    } finally {
      setBusy(null);
      if (folderInput.current) folderInput.current.value = "";
    }
  };
  const pickFolder = async () => chooseFolder(await pickDirectory());
  const toggleExcluded = async (path: string, excluded: boolean) => {
    if (!pendingRepository) return;
    const next = new Set(pendingRepository.excluded);
    if (excluded) next.add(path);
    else next.delete(path);
    setBusy("import");
    try {
      await readFolder(
        pendingRepository.picked,
        next,
        pendingRepository.choices,
      );
    } catch (cause) {
      failImport(pendingRepository.picked.name, cause);
    } finally {
      setBusy(null);
    }
  };

  const importFile = async (
    name: string,
    { file, omitted }: ProjectImport,
    withApprovals: boolean,
  ) => {
    setPendingImport(null);
    const importing = toast.loading(`Importing ${name}…`);
    setBusy("import");
    try {
      const created = await importProject(
        withApprovals
          ? file
          : {
              ...file,
              documents: file.documents.map((document) => ({
                ...document,
                approved: false,
              })),
            },
      );
      toast.success(`Imported ${name}.`, {
        id: importing,
        ...(omitted.length > 0
          ? { description: wording.importProject.omitted(omitted) }
          : {}),
      });
      onChanged();
      onOpen(created.projectId);
    } catch (cause) {
      failImport(name, cause, importing);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.homePage} data-slot="home-page">
      <section
        className={styles.newProject}
        aria-labelledby="new-project-title"
      >
        <hgroup className={styles.head}>
          <h1 id="new-project-title">{wording.newProject.title}</h1>
          <p>{wording.newProject.lead}</p>
        </hgroup>
        {needsProvider ? (
          <Banner tone="warning" title={wording.providers.none}>
            <p>{wording.providers.noneHint}</p>
            <BannerAction>
              <ConnectProvider onConnected={onChanged} />
            </BannerAction>
          </Banner>
        ) : null}
        {/* The project page's composer, the same frame as a project's. */}
        <Composer variant="page">
          <Dictated
            value={problem}
            onValueChange={setProblem}
            disabled={busy !== null}
          >
            {(mic) => (
              <PromptInput
                value={problem}
                onValueChange={setProblem}
                onSubmit={() => void start()}
                status={starting ? "submitted" : "ready"}
                disabled={busy !== null}
              >
                <PromptInputTextarea placeholder={HOME_COMPOSER_PLACEHOLDER} />
                <PromptInputToolbar>
                  <NewProjectProfile
                    value={profile}
                    onValueChange={setProfile}
                  />
                  {mic}
                  <PromptInputSubmit className="ms-auto" />
                </PromptInputToolbar>
              </PromptInput>
            )}
          </Dictated>
        </Composer>
        {shell.reply}
        <div className={styles.actions}>
          {starting ? (
            <ShimmerText role="status">
              {wording.newProject.starting}
            </ShimmerText>
          ) : null}
          <Button
            variant="link"
            loading={busy === "import"}
            disabled={busy !== null}
            title={wording.importProject.source}
            onClick={() => importInput.current?.click()}
          >
            {wording.importProject.action}
          </Button>
          <input
            ref={importInput}
            type="file"
            accept=".zip,application/zip,.json,application/json"
            hidden
            aria-label={wording.importProject.source}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void chooseImport(file);
            }}
          />
          <Button
            variant="link"
            disabled={busy !== null}
            title={wording.importProject.folderSource}
            onClick={() => {
              if (canPickDirectory()) void pickFolder();
              else folderInput.current?.click();
            }}
          >
            {wording.importProject.folderAction}
          </Button>
          <input
            ref={folderInput}
            type="file"
            // Lists a folder's files; React's input typings leave the attribute out.
            {...{ webkitdirectory: "" }}
            multiple
            hidden
            aria-label={wording.importProject.folderSource}
            onChange={(event) => {
              const listed = event.target.files;
              if (listed) void chooseFolder(listedDirectory(listed));
            }}
          />
        </div>
        {pendingImport === null ? null : (
          <Banner
            tone="warning"
            title={`${pendingImport.name} marks ${pendingImport.body.file.documents
              .filter((document) => document.approved)
              .map((document) => document.title)
              .join(", ")} as approved.`}
          >
            <p>
              Importing with approvals records your own approval of exactly
              these versions.
            </p>
            <div className={styles.importActions}>
              <Button
                variant="primary"
                onClick={() =>
                  void importFile(pendingImport.name, pendingImport.body, true)
                }
              >
                Import and approve
              </Button>
              <Button
                onClick={() =>
                  void importFile(pendingImport.name, pendingImport.body, false)
                }
              >
                Import without approvals
              </Button>
              <Button variant="ghost" onClick={() => setPendingImport(null)}>
                {wording.action.cancel}
              </Button>
            </div>
          </Banner>
        )}
        {pendingRepository === null ? null : (
          <RepositoryBanner
            pending={pendingRepository}
            busy={busy !== null}
            onExclude={(path, excluded) => void toggleExcluded(path, excluded)}
            onImport={() =>
              void importFile(
                pendingRepository.picked.name,
                { file: pendingRepository.reading.file, omitted: [] },
                false,
              )
            }
            onCancel={() => setPendingRepository(null)}
          />
        )}
      </section>
    </div>
  );
}

function RepositoryBanner({
  pending: { picked, reading, choices, excluded },
  busy,
  onExclude,
  onImport,
  onCancel,
}: {
  pending: PendingRepository;
  busy: boolean;
  onExclude: (path: string, excluded: boolean) => void;
  onImport: () => void;
  onCancel: () => void;
}) {
  const { report, file } = reading;
  const text = wording.importProject;
  const labels = (kinds: readonly string[]) =>
    kinds
      .map((kind) => DOCUMENT_LABELS[kind as keyof typeof DOCUMENT_LABELS])
      .join(", ");
  const found = file.documents
    .filter((document) => document.kind !== "app")
    .map((document) => document.kind);
  const toWrite = report.missing.filter((kind) => kind !== "app");
  const nothing = file.documents.length === 0;
  const code = report.app
    ? text.folderCode(report.app.files, describeBytes(report.app.bytes))
    : text.folderNoCode;
  return (
    <Banner
      tone={nothing ? "warning" : "okay"}
      title={text.folderTitle(report.title, picked.name)}
    >
      <p>{nothing ? text.folderNothing : code}</p>
      {found.length > 0 ? <p>{text.folderFound(labels(found))}</p> : null}
      {toWrite.length > 0 && !nothing ? (
        <p>{text.folderToWrite(labels(toWrite))}</p>
      ) : null}
      {report.warnings.length > 0 ? (
        <ul className={styles.folderNotes}>
          {report.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {choices.size > 0 ? (
        <div className={styles.folderFiles}>
          <p>{text.folderLeaveOut}</p>
          {[...choices].map(([path, reason]) => (
            <Checkbox
              key={path}
              label={`${path}, ${text.folderReasons[reason]}`}
              checked={excluded.has(path)}
              disabled={busy}
              onCheckedChange={(checked) => onExclude(path, checked === true)}
            />
          ))}
        </div>
      ) : null}
      <div className={styles.importActions}>
        <Button variant="primary" disabled={busy || nothing} onClick={onImport}>
          {text.folderImport}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {wording.action.cancel}
        </Button>
      </div>
    </Banner>
  );
}
