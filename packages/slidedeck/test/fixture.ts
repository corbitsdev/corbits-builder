import { crc32, deflateSync } from "node:zlib";

import { assetKey, type DeckInput } from "../src/index.ts";

function chunk(kind: string, data: Uint8Array) {
  const body = Buffer.concat([Buffer.from(kind), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour RGB PNG, so the fixture needs no binary files. */
export function solidPng(
  width: number,
  height: number,
  rgb: [number, number, number],
) {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk(
        "IDAT",
        deflateSync(Buffer.concat(Array.from({ length: height }, () => row))),
      ),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}

const logo = { path: "brand/logo.png" };
const mockup = { artifact: "mockup", version: 3 };

export const assets = new Map([
  [assetKey(logo), solidPng(240, 80, [109, 40, 217])],
  [assetKey(mockup), solidPng(1600, 900, [200, 220, 255])],
]);

const paragraph = (text: string) => ({ type: "paragraph" as const, text });

export const deck: DeckInput = {
  theme: {
    colors: {
      primary: "#6D28D9",
      secondary: "#0EA5E9",
      accent: "#F59E0B",
      background: "#FFFFFF",
      text: "#1B1B1F",
      muted: "#6B7280",
    },
    fonts: { heading: "Georgia", body: "Helvetica Neue" },
    logo,
  },
  footer: { text: "Builder · Confidential", slideNumbers: true },
  slides: [
    {
      layout: "title",
      title: "Builder overview",
      subtitle: "From idea to working app",
      notes: "Open with the problem.",
    },
    { layout: "section", title: "Why now", subtitle: "Three shifts" },
    {
      layout: "content",
      title: "What Builder does",
      body: [
        paragraph("Turns an idea into approved documents."),
        {
          type: "paragraph",
          text: [
            "Designs from ",
            { text: "your tokens", bold: true, color: "primary" },
            " & <brand>: ",
            { text: "italic", italic: true },
            ", ",
            { text: "underlined", underline: true },
            ", ",
            { text: "struck", strike: true },
            " and ",
            { text: "large\ntext", size: 28, color: "#EA580C" },
            ".",
          ],
        },
        {
          type: "list",
          items: [
            "Plans the work",
            {
              text: "Writes the documents",
              items: [
                "Constraints",
                {
                  text: "Approaches",
                  items: [
                    {
                      text: "Design concepts",
                      items: [{ text: "Theme", items: ["Tokens"] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      notes: "Keep it short.\r\nTwo lines of notes.",
    },
    {
      layout: "two-column",
      title: "Inputs and outputs",
      left: [
        paragraph("Idea, constraints"),
        {
          type: "list",
          ordered: true,
          items: [
            [
              "Read the ",
              {
                text: "guide",
                link: "HTTPS://corbits.dev/guide/über?a=1&b=2",
              },
            ],
            {
              text: "Describe the idea",
              items: [
                "Who it is for",
                { text: "What it does", items: ["Core job"] },
              ],
            },
            {
              text: [{ text: "Ask questions", link: 7 }],
              ordered: false,
              items: [
                [
                  {
                    text: "Email us",
                    link: "mailto:hello@corbits.dev",
                  },
                ],
              ],
            },
          ],
        },
        {
          type: "list",
          ordered: true,
          items: ["Review the plan", "Approve it"],
        },
      ],
      right: [
        paragraph("Docs, design, app"),
        { type: "image", image: mockup },
        paragraph("Live preview"),
      ],
    },
    {
      layout: "comparison",
      title: "Before and after",
      left: {
        heading: "Before",
        body: [paragraph("Manual specs"), paragraph("Slow handoffs")],
      },
      right: {
        heading: "After",
        body: [paragraph("Agent-written docs"), paragraph("Approvals in chat")],
      },
    },
    {
      layout: "image",
      title: "The mockup",
      image: mockup,
      caption: "Home screen",
    },
    {
      layout: "image",
      image: mockup,
      fit: "cover",
    },
    {
      layout: "blank",
      body: [
        paragraph("Questions?"),
        {
          type: "list",
          items: [
            [{ text: "Back to the start", link: 0 }],
            { text: "Contact", items: ["hello@corbits.dev"] },
          ],
        },
      ],
      notes: "Leave time for questions.",
    },
  ],
};
