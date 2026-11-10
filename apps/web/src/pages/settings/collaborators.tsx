/**
 * Collaborators: who this workspace belongs to, its roles, and its open
 * invitations.
 */
import {
  useCollaborators,
  type CollaboratorsProps,
} from "./collaborators.model.ts";
import { CollaboratorsView } from "./collaborators.view.tsx";

export function Collaborators(props: CollaboratorsProps) {
  return <CollaboratorsView {...useCollaborators(props)} />;
}
