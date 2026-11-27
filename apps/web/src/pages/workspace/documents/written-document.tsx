/**
 * A written document read as a printed page. `document-page.model.ts` holds what it does and
 * `written-document.view.tsx` how it looks.
 */
import {
  useDocumentPage,
  type DocumentPageProps,
} from "./document-page.model.ts";
import { WrittenDocumentView } from "./written-document.view.tsx";

export function WrittenDocument(props: DocumentPageProps) {
  return <WrittenDocumentView {...useDocumentPage(props)} />;
}
