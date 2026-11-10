/**
 * The New project page as it looks: one prompt to start something, the two
 * ways to import a project, and the notices an import waits on.
 */
import { useRef } from "react";
import {
  Checkbox,
  PromptInput,
  PromptInputModelSelect,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  ShimmerText,
  type PromptInputModelOption,
} from "@corbits/react-ui";
import { wording } from "../config.ts";
import { Banner, BannerAction, Button } from "../components.jsx";
import { Dictated } from "../dictation.jsx";
import { useShellReply } from "../flourish.tsx";
import { Composer } from "../composer.tsx";
import { HOME_COMPOSER_PLACEHOLDER } from "./home-view.ts";
import styles from "./projects.module.css";

/** A folder read as a project, in the words the page shows before importing it. */
export type FolderReading = {
  /** The project's title as the folder gives it. */
  title: string;
  folderName: string;
  /** The code that would be filed as the app; null when the folder has none. */
  code: { files: number; size: string } | null;
  /** The names of the documents found in the folder. */
  found: readonly string[];
  /** The names of the documents still to write. */
  toWrite: readonly string[];
  /** Neither code nor documents were found, so there is nothing to import. */
  empty: boolean;
  warnings: readonly string[];
  /** Files the reading suggests leaving out, each with why, and whether it is left out. */
  leaveOut: readonly { path: string; reason: string; leftOut: boolean }[];
};

export type ProjectsViewProps = {
  /** What the page is busy with; the prompt and both imports wait until it is idle. */
  activity: "idle" | "starting" | "importing";
  /** The idea in the prompt box. */
  idea: string;
  onIdeaChange: (idea: string) => void;
  onStart: () => void;
  /** The model profiles a project can start on; the picker is absent when there are none. */
  profiles: readonly PromptInputModelOption[];
  profile: string | undefined;
  onProfileChange: (profile: string) => void;
  /** No model provider is connected, so the page offers to connect one first. */
  needsProvider: boolean;
  onConnectProvider: () => void;
  onImportFile: (file: File) => void;
  /** Opens the browser's own folder picker; null where it has none, and the page lists a folder's files instead. */
  onPickFolder: (() => void) | null;
  onImportFolderFiles: (files: readonly File[]) => void;
  /** A chosen project file that marks documents approved, their titles, and the person's answer. */
  approvals: {
    fileName: string;
    documents: readonly string[];
    onImport: (approve: boolean) => void;
    onCancel: () => void;
  } | null;
  /** A chosen folder, read and waiting on the person's go-ahead. */
  folder: {
    reading: FolderReading;
    onLeaveOut: (path: string, leftOut: boolean) => void;
    onImport: () => void;
    onCancel: () => void;
  } | null;
};

export function ProjectsView({
  activity,
  idea,
  onIdeaChange,
  onStart,
  profiles,
  profile,
  onProfileChange,
  needsProvider,
  onConnectProvider,
  onImportFile,
  onPickFolder,
  onImportFolderFiles,
  approvals,
  folder,
}: ProjectsViewProps) {
  const busy = activity !== "idle";
  const starting = activity === "starting";
  const shell = useShellReply(useRef<HTMLElement>(null));
  const importInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const submit = () => {
    if (shell.answers(idea)) return onIdeaChange("");
    onStart();
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
              <Button variant="primary" onClick={onConnectProvider}>
                {wording.providers.connect}
              </Button>
            </BannerAction>
          </Banner>
        ) : null}
        {/* The project page's composer, the same frame as a project's. */}
        <Composer variant="page">
          <Dictated value={idea} onValueChange={onIdeaChange} disabled={busy}>
            {(mic) => (
              <PromptInput
                value={idea}
                onValueChange={onIdeaChange}
                onSubmit={submit}
                status={starting ? "submitted" : "ready"}
                disabled={busy}
              >
                <PromptInputTextarea placeholder={HOME_COMPOSER_PLACEHOLDER} />
                <PromptInputToolbar>
                  {profile === undefined ? null : (
                    <PromptInputModelSelect
                      label={wording.profiles.pick}
                      models={[...profiles]}
                      value={profile}
                      onValueChange={onProfileChange}
                    />
                  )}
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
            loading={activity === "importing"}
            disabled={busy}
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
              // Cleared so choosing the same file again is still a change.
              event.target.value = "";
              if (file) onImportFile(file);
            }}
          />
          <Button
            variant="link"
            disabled={busy}
            title={wording.importProject.folderSource}
            onClick={onPickFolder ?? (() => folderInput.current?.click())}
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
              if (event.target.files === null) return;
              const listed = [...event.target.files];
              event.target.value = "";
              onImportFolderFiles(listed);
            }}
          />
        </div>
        {approvals === null ? null : (
          <Banner
            tone="warning"
            title={`${approvals.fileName} marks ${approvals.documents.join(", ")} as approved.`}
          >
            <p>
              Importing with approvals records your own approval of exactly
              these versions.
            </p>
            <div className={styles.importActions}>
              <Button
                variant="primary"
                onClick={() => approvals.onImport(true)}
              >
                Import and approve
              </Button>
              <Button onClick={() => approvals.onImport(false)}>
                Import without approvals
              </Button>
              <Button variant="ghost" onClick={approvals.onCancel}>
                {wording.action.cancel}
              </Button>
            </div>
          </Banner>
        )}
        {folder === null ? null : <FolderBanner {...folder} busy={busy} />}
      </section>
    </div>
  );
}

function FolderBanner({
  reading: {
    title,
    folderName,
    code,
    found,
    toWrite,
    empty,
    warnings,
    leaveOut,
  },
  busy,
  onLeaveOut,
  onImport,
  onCancel,
}: NonNullable<ProjectsViewProps["folder"]> & { busy: boolean }) {
  const text = wording.importProject;
  const codeLine =
    code === null ? text.folderNoCode : text.folderCode(code.files, code.size);
  return (
    <Banner
      tone={empty ? "warning" : "okay"}
      title={text.folderTitle(title, folderName)}
    >
      <p>{empty ? text.folderNothing : codeLine}</p>
      {found.length > 0 ? <p>{text.folderFound(found.join(", "))}</p> : null}
      {toWrite.length > 0 && !empty ? (
        <p>{text.folderToWrite(toWrite.join(", "))}</p>
      ) : null}
      {warnings.length > 0 ? (
        <ul className={styles.folderNotes}>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {leaveOut.length > 0 ? (
        <div className={styles.folderFiles}>
          <p>{text.folderLeaveOut}</p>
          {leaveOut.map(({ path, reason, leftOut }) => (
            <Checkbox
              key={path}
              label={`${path}, ${reason}`}
              checked={leftOut}
              disabled={busy}
              onCheckedChange={(checked) => onLeaveOut(path, checked === true)}
            />
          ))}
        </div>
      ) : null}
      <div className={styles.importActions}>
        <Button variant="primary" disabled={busy || empty} onClick={onImport}>
          {text.folderImport}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {wording.action.cancel}
        </Button>
      </div>
    </Banner>
  );
}
