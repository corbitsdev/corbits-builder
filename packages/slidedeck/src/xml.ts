export const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const NAMESPACES =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const RELATIONSHIP_TYPES =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// XML 1.0 has no escape for these control characters; one would make the whole part unreadable.
const FORBIDDEN = /[^\P{Cc}\t\n\r]|\p{Noncharacter_Code_Point}/gu;

export const escapeXml = (text: string) =>
  text
    .replace(FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type Relationship = { id: string; type: string; target: string };

const relationshipsXml = (items: readonly Relationship[]) =>
  `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(
      ({ id, type, target }) =>
        `<Relationship Id="${id}" Type="${type.includes("://") ? type : `${RELATIONSHIP_TYPES}/${type}`}" Target="${target}"/>`,
    )
    .join("")}</Relationships>`;

/** One part's relationships, numbered in the order they are added. */
export class Relationships {
  readonly #items: Relationship[] = [];

  /** `type` is a full URI, or a name under the officeDocument relationships namespace. */
  add(type: string, target: string) {
    const id = `rId${this.#items.length + 1}`;
    this.#items.push({ id, type, target });
    return id;
  }

  xml() {
    return relationshipsXml(this.#items);
  }
}
