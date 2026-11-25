import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpecialistBuilder } from "@corbits-builder/plugin";
import { usePromptBox } from "./prompt-box.model.ts";
import room, { TabStatus } from "./room.stories.tsx";
import { RoomView, type RoomViewProps } from "./room.view.tsx";
import { storySupplies } from "./screen-story.tsx";
import { installScreens, screensFor, type ScreenFiles } from "./screens.ts";

// Every plugin's screens, as the interface bundles them.
const plugins = join(import.meta.dir, "../../../../../plugins");
const files: ScreenFiles = {
  manifests: {},
  definitions: {},
  data: {},
  views: {},
};
const screens: { plugin: string; action: string }[] = [];
for (const folder of readdirSync(plugins)) {
  const manifest = await import(join(plugins, folder, "package.json"));
  files.manifests[`plugins/${folder}/package.json`] = manifest.default;
  const builder = manifest.default.builder;
  if (builder?.runs !== "specialist") continue;
  const { handle, actions } = SpecialistBuilder.assert(builder);
  for (const action of Object.keys(actions)) {
    const at = join(plugins, folder, "src", action);
    const view = Bun.file(join(at, "view.tsx"));
    if (!(await view.exists())) continue;
    files.definitions[`plugins/${folder}/src/${action}/definition.ts`] = (
      await import(join(at, "definition.ts"))
    ).default;
    files.views[`plugins/${folder}/src/${action}/view.tsx`] = (
      await import(join(at, "view.tsx"))
    ).default;
    const data = Bun.file(join(at, "data.json"));
    if (await data.exists())
      files.data[`plugins/${folder}/src/${action}/data.json`] =
        await data.json();
    screens.push({ plugin: handle, action });
  }
}
installScreens(files);

const VIEW = 'data-slot="screen-view"';

/** The room with the coordinator asking one screen, placed where the prompt box decides. */
function Asking({
  screen,
  projectOpen,
}: {
  screen: { plugin: string; action: string };
  projectOpen: boolean;
}) {
  const box = usePromptBox({
    projectId: "project-1",
    archived: false,
    openQuestion: {
      at: 0,
      signalName: "signal-1",
      asked: { plugin: screen.plugin, action: screen.action, input: {} },
      status: "open",
    },
    onAnswer: async () => true,
    sending: false,
    approvals: [],
    approvalBusy: false,
    approvalError: null,
    typedYes: null,
    onDecide: async () => null,
    onRequestChanges: () => {},
    plan: [],
    screens: [],
    screenOf: screensFor({}),
    supplies: storySupplies,
    projectValues: { read: async () => ({}) },
    act: async () => undefined,
    restarts: null,
    thinking: false,
    dispatches: [],
    dispatchRoom: { artifacts: [], inFlight: [], failed: [], seen: new Map() },
    failed: [],
    lastSentAt: null,
    documents: [],
    seen: {},
    hasApp: false,
    projectOpen,
    onOpenDocument: () => {},
    onOpenApp: () => {},
    onSend: () => {},
    reload: () => {},
  });
  return (
    <RoomView
      {...room.args}
      layout={{ ...room.args.layout, projectReady: true, projectOpen }}
      waiting={box.waiting}
      space={box.space}
      pluginSpace={<i data-slot="screen-view" />}
    />
  );
}

/** The room drawn with one screen asked, and what its box holds; the box is drawn last. */
function drawn(
  screen: { plugin: string; action: string },
  projectOpen: boolean,
) {
  const installed = screensFor({})(screen);
  if (installed === undefined) throw new Error(`No screen ${screen.action}`);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Asking screen={screen} projectOpen={projectOpen} />
    </QueryClientProvider>,
  );
  const box = html.slice(html.indexOf('data-slot="room-dock"'));
  return { placement: installed.placement, html, box };
}

describe.each(screens)("$plugin $action", (screen) => {
  test("its view is drawn once, and never in the prompt box when it fills the main pane", () => {
    for (const projectOpen of [false, true]) {
      const { placement, html, box } = drawn(screen, projectOpen);
      expect(html.split(VIEW).length - 1).toBeLessThanOrEqual(1);
      if (placement.mainPane) expect(box).not.toContain(VIEW);
      else expect(box).toContain(VIEW);
    }
  });
});

test("the room's top right holds an action only where a screen puts one and its tab can open", () => {
  const shown = (args: Partial<RoomViewProps>) =>
    renderToStaticMarkup(
      <RoomView {...room.args} {...TabStatus.args} {...args} />,
    );
  const actions = shown({});
  expect(actions.slice(actions.indexOf('data-slot="room-actions"'))).toContain(
    "Published",
  );
  expect(shown({ topRight: [] })).not.toContain('data-slot="room-actions"');
  expect(shown({ layout: room.args.layout })).not.toContain(
    'data-slot="room-actions"',
  );
});
