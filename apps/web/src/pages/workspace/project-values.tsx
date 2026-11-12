/**
 * The project values tab: `project-values.model.ts` reads and saves them through the hub and
 * `project-values.view.tsx` lists each with an editor fit for its type.
 */
import {
  useProjectValues,
  type ProjectValuesProps,
} from "./project-values.model.ts";
import { ProjectValuesView } from "./project-values.view.tsx";

export function ProjectValues(props: ProjectValuesProps) {
  return <ProjectValuesView {...useProjectValues(props)} />;
}
