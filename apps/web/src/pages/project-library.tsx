/**
 * Projects: every project the person can see, as cards they can filter by
 * stage.
 */
import {
  useProjectLibrary,
  type ProjectLibraryProps,
} from "./project-library.model.ts";
import { ProjectLibraryView } from "./project-library.view.tsx";
import { ProjectMenu } from "./project-menu.jsx";

export function ProjectLibrary(props: ProjectLibraryProps) {
  const { view, menuOf } = useProjectLibrary(props);
  return (
    <ProjectLibraryView
      {...view}
      menu={(projectId, trigger) => (
        <ProjectMenu {...menuOf(projectId)} trigger={trigger} />
      )}
    />
  );
}
