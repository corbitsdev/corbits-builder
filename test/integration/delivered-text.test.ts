import { expect, test } from "bun:test";
import {
  assembleSignedContent,
  decodePartBytes,
  extractPartByPath,
  parseMimePart,
} from "@intx/mime";
import { deliveredText } from "@corbits-builder/schemas/conversation";

// Mail must deliver a typed message as `deliveredText` of it, or the page will not recognise its
// copy.
const delivered = (text: string, withFile: boolean) => {
  const file = {
    name: "notes.txt",
    contentType: "text/plain",
    data: new TextEncoder().encode("notes"),
  };
  const signed = assembleSignedContent({
    kind: "conversation",
    text,
    ...(withFile ? { attachments: [file] } : {}),
  });
  const part = parseMimePart(extractPartByPath(signed, "1"));
  return new TextDecoder()
    .decode(decodePartBytes(part.body, part.headers))
    .replace(/\r\n?/g, "\n");
};

test("mail delivers a typed message as its deliveredText, with or without a file", () => {
  const typed = [
    "First line  \nkeep  two  spaces\t\n\nthird \t ",
    "old \rline \r\nbreaks\r\rend",
    "no-break\u00a0\nideographic\u3000\nline\u2028separator\u0085next",
    "code:\n    indented line\n\tTabbed",
    "From here on\n.\nlone dot",
    "café 😀  \nnaïve",
    `${"x".repeat(1200)}  \nb`,
  ];
  for (const text of typed.map((raw) => raw.trim())) {
    expect(delivered(text, false)).toBe(deliveredText(text));
    expect(delivered(text, true)).toBe(deliveredText(text));
  }
});
