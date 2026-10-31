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
import { Banner, Button } from "../components.jsx";
import { ConnectProvider } from "./providers.jsx";
import { NewProjectProfile } from "./profile-select.jsx";
import { Dictated } from "../dictation.jsx";
import { useShellReply } from "../flourish.tsx";
import { COMPOSER_BOX_CLASS } from "./workspace/pane-classes.ts";
import { HOME_COMPOSER_PLACEHOLDER, canStartProject } from "./home-view.ts";
import "./home-layout.css";
import type { ProjectImport } from "@corbits-builder/schemas/project-import";

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
  const [error, setError] = useState<string | null>(null);
  const starting = busy === "start";
  const shell = useShellReply(useRef<HTMLElement>(null));

  const start = async () => {
    if (busy !== null) return;
    if (shell.answers(problem)) return setProblem("");
    if (!canStartProject(problem)) {
      setError(wording.message.projectTooShort);
      return;
    }
    setBusy("start");
    setError(null);
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
      setError(
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
    <div className="home-page">
      <section className="new-project" aria-labelledby="new-project-title">
        <hgroup className="new-project-head">
          <h1 id="new-project-title">{wording.newProject.title}</h1>
          <p>{wording.newProject.lead}</p>
        </hgroup>
        {error ? <Banner tone="error" title={error} /> : null}
        {needsProvider ? (
          <Banner tone="warning" title={wording.providers.none}>
            <p>{wording.providers.noneHint}</p>
            <div className="banner-action">
              <ConnectProvider onConnected={onChanged} />
            </div>
          </Banner>
        ) : null}
        {/* The project page's composer, the same markup under the same class. */}
        <div className="composer">
          <Dictated
            value={problem}
            onValueChange={setProblem}
            disabled={busy !== null}
          >
            {(mic) => (
              <PromptInput
                className={COMPOSER_BOX_CLASS}
                value={problem}
                onValueChange={setProblem}
                onSubmit={() => void start()}
                status={starting ? "submitted" : "ready"}
                disabled={busy !== null}
              >
                <PromptInputTextarea placeholder={HOME_COMPOSER_PLACEHOLDER} />
                <PromptInputToolbar>
                  {mic}
                  <NewProjectProfile
                    value={profile}
                    onValueChange={setProfile}
                  />
                  <PromptInputSubmit className="ms-auto" />
                </PromptInputToolbar>
              </PromptInput>
            )}
          </Dictated>
        </div>
        {shell.reply}
        <div className="new-project-actions">
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
            <div className="import-confirm-actions">
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
      </section>
    </div>
  );
}
