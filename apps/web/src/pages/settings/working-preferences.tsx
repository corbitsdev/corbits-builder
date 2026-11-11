import type { ReactNode } from "react";
import {
  useWorkingPreferences,
  type WorkingPreferencesProps,
} from "./working-preferences.model.ts";
import { WorkingPreferencesView } from "./working-preferences.view.tsx";

/** The person's working preferences, from the hub's registry and kept by the hub, which
 * delivers them to every role they apply to, and the ones this browser keeps. Each change saves
 * as it is made. */
export function WorkingPreferences({
  reviewers,
  ...props
}: WorkingPreferencesProps & { reviewers: ReactNode }) {
  return (
    <WorkingPreferencesView
      {...useWorkingPreferences(props)}
      reviewers={reviewers}
    />
  );
}
