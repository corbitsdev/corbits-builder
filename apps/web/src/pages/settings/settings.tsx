/**
 * Settings: Providers, Profiles, Preferences, Collaborators, Secrets and About, grouped
 * into tabs. The sections that read the hub fill the view's slots, so each
 * mounts only while its tab is open.
 */
import { ProvidersSection } from "./providers.jsx";
import { Profiles } from "./profiles.jsx";
import { WorkspaceApprovals } from "./workspace-approvals.tsx";
import { WorkingPreferences } from "./working-preferences.tsx";
import { Collaborators } from "./collaborators.jsx";
import { useSecretsSection } from "./secrets.model.ts";
import { SecretsSectionView } from "./secrets.view.tsx";
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
      secrets={<Secrets />}
      workingPreferences={
        <WorkingPreferences
          {...workingPreferences}
          reviewers={<WorkspaceApprovals />}
        />
      }
    />
  );
}

// Its own component, so the secrets are read only while their tab is open.
function Secrets() {
  return <SecretsSectionView {...useSecretsSection()} />;
}
