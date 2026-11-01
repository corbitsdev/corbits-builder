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
const mark = { path: "brand/mark.svg" };

export const assets = new Map([
  [assetKey(logo), solidPng(240, 80, [109, 40, 217])],
  [assetKey(mockup), solidPng(1600, 900, [200, 220, 255])],
  [
    assetKey(mark),
    new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#6D28D9"/></svg>',
    ),
  ],
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
      transition: { type: "fade", duration: 400 },
    },
    {
      layout: "section",
      title: "Why now",
      subtitle: "Three shifts",
      transition: { type: "push", from: "bottom" },
    },
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
      transition: { type: "wipe", from: "left", duration: 1200 },
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
    {
      layout: "free",
      transition: { type: "morph", duration: 1500 },
      background: {
        type: "linear",
        angle: 135,
        stops: [
          { color: "#0F1020", at: 0 },
          { color: "primary", at: 100, opacity: 0.9 },
        ],
      },
      elements: [
        {
          id: "glow",
          type: "shape",
          geometry: "ellipse",
          x: 860,
          y: -120,
          w: 520,
          h: 520,
          opacity: 0.6,
          fill: {
            type: "radial",
            stops: [
              { color: "accent", at: 0 },
              { color: "#F59E0B", at: 60, opacity: 0.4 },
              { color: "#F59E0B", at: 100, opacity: 0 },
            ],
          },
        },
        {
          id: "card",
          type: "group",
          children: [
            {
              id: "card-back",
              type: "shape",
              geometry: "roundRect",
              x: 80,
              y: 200,
              w: 560,
              h: 360,
              radius: 24,
              fill: "background",
              border: { width: 1, color: "#E5E7EB", dash: "solid" },
              shadow: {
                x: 0,
                y: 12,
                blur: 32,
                color: "#000000",
                opacity: 0.25,
              },
            },
            {
              type: "shape",
              geometry: "roundRect",
              x: 80,
              y: 200,
              w: 560,
              h: 8,
              radius: [24, 24, 0, 0],
              fill: "primary",
            },
            {
              type: "group",
              opacity: 0.8,
              children: [
                {
                  type: "shape",
                  geometry: "line",
                  x: 120,
                  y: 440,
                  w: 480,
                  h: 0,
                  border: { width: 2, color: "muted", dash: "dash" },
                },
              ],
            },
          ],
        },
        {
          id: "headline",
          type: "text",
          x: 120,
          y: 240,
          w: 480,
          h: 160,
          anchor: "middle",
          insets: { top: 4, right: 8, bottom: 4, left: 8 },
          link: 0,
          paragraphs: [
            {
              lineHeight: 64,
              runs: [
                {
                  text: "Designed\nslides",
                  font: "Georgia",
                  size: 56,
                  weight: 800,
                  letterSpacing: -1,
                  color: {
                    type: "linear",
                    angle: 90,
                    stops: [
                      { color: "primary", at: 0 },
                      { color: "secondary", at: 100 },
                    ],
                  },
                },
              ],
            },
            {
              align: "center",
              spaceBefore: 12,
              runs: [
                "Text, ",
                { text: "italic", italic: true, weight: 300 },
                " and a ",
                {
                  text: "link",
                  link: "https://corbits.dev",
                  color: "#0EA5E9",
                  underline: true,
                },
              ],
            },
          ],
        },
        {
          id: "cover",
          type: "image",
          image: mockup,
          x: 700,
          y: 200,
          w: 500,
          h: 300,
          fit: "cover",
          radius: [16, 0, 16, 0],
          border: { width: 2, color: "#FFFFFF", dash: "dot", opacity: 0.5 },
          shadow: { x: 4, y: 8, blur: 16, spread: 2, color: "text" },
        },
        {
          type: "image",
          image: mockup,
          x: 700,
          y: 530,
          w: 240,
          h: 120,
          fit: "contain",
          rotation: -4,
        },
        {
          id: "mark",
          type: "image",
          image: logo,
          svg: mark,
          x: 980,
          y: 530,
          w: 120,
          h: 120,
          crop: { top: 0, right: 0.5, bottom: 0, left: 0 },
          opacity: 0.9,
          link: "mailto:hello@corbits.dev",
        },
        {
          id: "tag",
          type: "shape",
          geometry: "rect",
          x: 1120,
          y: 560,
          w: 80,
          h: 40,
          fill: "#10B981",
        },
      ],
      animations: [
        {
          target: "card",
          effect: "fade",
          kind: "entrance",
          trigger: "afterPrevious",
        },
        {
          target: "headline",
          effect: "fly",
          kind: "entrance",
          side: "left",
          trigger: "withPrevious",
          delay: 200,
          easing: { accel: 0, decel: 0.6 },
        },
        { target: "cover", effect: "zoom", kind: "entrance", duration: 700 },
        {
          target: "tag",
          effect: "wipe",
          kind: "entrance",
          side: "left",
          trigger: "afterPrevious",
        },
        {
          target: "mark",
          effect: "spin",
          degrees: 180,
          trigger: "withPrevious",
        },
        { target: "tag", effect: "pulse", repeat: 3 },
        { target: "card", effect: "scale", scale: 1.1 },
        {
          target: "glow",
          effect: "path",
          path: "M 0 0 L -0.1 0.05 E",
          repeat: "indefinite",
          trigger: "withPrevious",
        },
        { target: "mark", effect: "fly", kind: "exit", side: "bottom" },
        {
          target: "tag",
          effect: "wipe",
          kind: "exit",
          side: "right",
          trigger: "afterPrevious",
        },
        {
          target: "cover",
          effect: "zoom",
          kind: "exit",
          trigger: "withPrevious",
        },
        {
          target: "headline",
          effect: "fade",
          kind: "exit",
          trigger: "afterPrevious",
        },
      ],
      notes: "Every free-form element, transition and animation.",
    },
  ],
};
