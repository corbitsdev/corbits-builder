/**
 * Settings: Providers, Profiles, Preferences, Collaborators and About, grouped
 * into tabs. The sections that read the hub fill the view's slots, so each
 * mounts only while its tab is open.
 */
import { ProvidersSection } from "./providers.jsx";
import { Profiles } from "./profiles.jsx";
import { WorkspaceApprovals } from "./workspace-approvals.tsx";
import { WorkingPreferences } from "./working-preferences.tsx";
import { Collaborators } from "./collaborators.jsx";
import { useSettings, type SettingsProps } from "./settings.model.ts";
import { SettingsView } from "./settings.view.tsx";

export function Settings(props: SettingsProps) {
  const { view, workingPreferences } = useSettings(props);
  return (
    <SettingsView
      {...view}
      providers={<ProvidersSection onChanged={props.onChanged} />}
      profiles={<Profiles />}
      collaborators={<Collaborators user={props.user ?? null} />}
      workingPreferences={
        <WorkingPreferences
          {...workingPreferences}
          reviewers={<WorkspaceApprovals />}
        />
      }
    />
  );
}
