/**
 * The app as the person can use it, run by the hub from the project's current files while the
 * project is open. `live-app.model.ts` reads how the app and its builder stand and
 * `live-app.view.tsx` draws the pane; the first app taking shape keeps its own clock, so it is
 * read only while it is on the pane.
 */
import type { InFlightRun } from "@corbits-builder/schemas/artifact";
import {
  useBuilderSetup,
  useLiveApp,
  type LiveAppProps,
} from "./live-app.model.ts";
import { BuilderSetupView, LiveAppView } from "./live-app.view.tsx";

function BuilderSetup({
  projectId,
  builder,
}: {
  projectId: string;
  builder: InFlightRun;
}) {
  return <BuilderSetupView {...useBuilderSetup(projectId, builder)} />;
}

export function LiveApp(props: LiveAppProps) {
  const { projectId, builder } = props;
  return (
    <LiveAppView
      {...useLiveApp(props)}
      builderSetup={
        builder === undefined ? null : (
          <BuilderSetup projectId={projectId} builder={builder} />
        )
      }
    />
  );
}
