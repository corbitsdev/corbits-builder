/**
 * New project: the landing page. One prompt to start something; the projects
 * themselves are listed in the rail.
 */
import { AddProviderDialog } from "./settings/add-provider-dialog.tsx";
import { useProjects, type ProjectsProps } from "./projects.model.ts";
import { ProjectsView } from "./projects.view.tsx";

export function Projects(props: ProjectsProps) {
  const { view, providerDialog } = useProjects(props);
  return (
    <>
      <ProjectsView {...view} />
      <AddProviderDialog {...providerDialog} />
    </>
  );
}
