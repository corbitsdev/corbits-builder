import { DesignBundle } from "@corbits-builder/schemas/artifact";

export function sourceDocument(document: {
  kind: string;
  title: string;
  content: string;
}) {
  if (document.kind !== "design") return document;
  const { files } = DesignBundle.assert(JSON.parse(document.content));
  const screens = Object.keys(files).filter((path) =>
    path.startsWith("designs/"),
  );
  return {
    ...document,
    content: files["DESIGN.md"] + "\n\nScreens: " + screens.join(", "),
  };
}
