import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppView, type AppViewProps } from "./App.view.tsx";
import { wording } from "./config.ts";

test("the hub notice replaces a failed setup request while the hub is unreachable", () => {
  const props: AppViewProps = {
    current: "project",
    rail: {
      collapsed: true,
      onToggleCollapsed: () => {},
      onNewProject: () => {},
      onLibrary: () => {},
      onBack: () => {},
      onSettings: () => {},
      projects: [],
      onOpenProject: () => {},
    },
    workspaceMenu: null,
    projectMenu: (_id, trigger) => trigger,
    hub: { state: "notAnswering" },
    setupFault: "Failed to fetch",
    page: <p>Project documents</p>,
    onOpenPreferences: () => {},
  };
  const offline = renderToStaticMarkup(<AppView {...props} />);
  expect(offline).toContain(wording.hub.notAnswering);
  expect(offline).not.toContain("Failed to fetch");
  expect(offline).not.toContain(wording.workspace.setupIncomplete);
  expect(offline).toContain("Project documents");

  const online = renderToStaticMarkup(
    <AppView {...props} hub={{ state: "answering" }} />,
  );
  expect(online).not.toContain(wording.hub.notAnswering);
  expect(online).toContain("Failed to fetch");
});
