const SHEET_CLASS = "print-sheet";
// Controls and selection affordances stay on screen; a document mention prints as its text.
const SCREEN_ONLY = ".pane-bar, .passage-offer, button:not(.artifact-mention)";

/**
 * Prints the document a pane shows through the browser's dialog, whose "Save as PDF"
 * destination makes the file. The app's fixed, scrolling layout cannot be paginated in
 * place, so the rendered document is copied onto a sheet of its own for the print.
 */
export function printDocument(
  pane: HTMLElement,
  fileName: string,
  status: string,
): void {
  const body = pane.querySelector(".deliverable-body");
  if (body === null) return;
  const copy = body.cloneNode(true) as HTMLElement;
  for (const element of copy.querySelectorAll(SCREEN_ONLY)) element.remove();
  const statusLine = document.createElement("p");
  statusLine.className = "print-sheet-status";
  statusLine.textContent = status;
  const header = copy.querySelector(".document-header");
  if (header === null) copy.prepend(statusLine);
  else header.append(statusLine);

  const sheet = document.createElement("article");
  sheet.className = SHEET_CLASS;
  sheet.append(copy);
  const appTitle = document.title;
  // The dialog names the PDF after the page title.
  document.title = fileName;
  document.body.append(sheet);
  window.addEventListener(
    "afterprint",
    () => {
      sheet.remove();
      document.title = appTitle;
    },
    { once: true },
  );
  window.print();
}
