/** Model profiles: the model and effort of each tier. */
import { useProfiles, type ProfilesProps } from "./profiles.model.ts";
import { ProfilesView } from "./profiles.view.tsx";

export function Profiles(props: ProfilesProps = {}) {
  return <ProfilesView {...useProfiles(props)} />;
}
