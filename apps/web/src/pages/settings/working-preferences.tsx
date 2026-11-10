import {
  useWorkingPreferences,
  type WorkingPreferencesProps,
} from "./working-preferences.model.ts";
import { WorkingPreferencesView } from "./working-preferences.view.tsx";

/** The person's working preferences, from the hub's registry and kept by the hub, which
 * delivers them to every role they apply to. Each change saves as it is made. */
export function WorkingPreferences(props: WorkingPreferencesProps = {}) {
  return <WorkingPreferencesView {...useWorkingPreferences(props)} />;
}
