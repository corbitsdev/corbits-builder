/**
 * The app shell, with the screens and pages that read the hub put in their
 * places.
 */
import { Toaster } from "sonner";
import { useTheme } from "@corbits/react-ui";
import { useApp, useBoot, type ShellPage } from "./App.model.ts";
import {
  AppView,
  BootView,
  NoProjectOpen,
  ProjectLoadFailure,
} from "./App.view.tsx";
import { FineMode } from "./flourish.tsx";
import { Auth } from "./pages/auth.jsx";
import { InvitationAccept } from "./pages/invite-accept.jsx";
import { ModelSetup } from "./pages/model-setup.tsx";
import { ProjectLibrary } from "./pages/project-library.jsx";
import { ProjectMenu } from "./pages/project-menu.jsx";
import { Projects } from "./pages/projects.jsx";
import { Settings } from "./pages/settings/settings.jsx";
import { StageWorkspace } from "./pages/workspace/index.tsx";
import { WorkspaceMenu } from "./workspace-menu.tsx";

export function App() {
  const { resolvedMode } = useTheme();
  const app = useApp();

  if (app.screen === "boot") return <Booting offline={app.offline} />;
  if (app.screen === "auth") return <Auth onSignedIn={app.onSignedIn} />;
  if (app.screen === "modelSetup")
    return <ModelSetup onConnected={app.onConnected} onLater={app.onLater} />;
  if (app.screen === "invite")
    return (
      <>
        <InvitationAccept invitationId={app.invitationId} />
        <Toaster theme={resolvedMode} richColors closeButton />
      </>
    );

  return (
    <>
      <AppView
        {...app.view}
        workspaceMenu={<WorkspaceMenu onOpen={app.onOpenWorkspace} />}
        projectMenu={(projectId, trigger) => (
          <ProjectMenu
            {...app.menuOf(projectId)}
            align="start"
            trigger={trigger}
          />
        )}
        page={app.page === null ? null : shellPage(app.page)}
      />
      {/* Outside the .app grid: its section would otherwise take the canvas's row. */}
      <Toaster theme={resolvedMode} richColors closeButton />
      <FineMode />
    </>
  );
}

function Booting({ offline }: { offline: boolean }) {
  return <BootView {...useBoot(offline)} />;
}

function shellPage(page: ShellPage) {
  switch (page.name) {
    case "newProject":
      return <Projects {...page.props} />;
    case "library":
      return <ProjectLibrary {...page.props} />;
    case "project":
      return <StageWorkspace key={page.props.projectId} {...page.props} />;
    case "noProject":
      return <NoProjectOpen />;
    case "projectLoadFailure":
      return <ProjectLoadFailure {...page.props} />;
    case "settings":
      return <Settings {...page.props} />;
  }
}
