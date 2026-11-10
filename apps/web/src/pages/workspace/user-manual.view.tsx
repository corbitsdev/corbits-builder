import type { UserManual } from "@corbits-builder/schemas/artifact";
import { Markdown } from "../../markdown.tsx";

export type UserManualViewProps = {
  /** The manual as written, and its pictures by the path the manual places them at. */
  manual: UserManual;
};

/** The manual's pages, its pictures shown where it places them; the pane around it scrolls. */
export function UserManualView({ manual }: UserManualViewProps) {
  return (
    <Markdown
      document
      source={manual.markdown}
      images={new Map(Object.entries(manual.pictures))}
    />
  );
}
