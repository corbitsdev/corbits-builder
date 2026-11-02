import { expect, test } from "bun:test";
import { crc32, deflateSync, inflateSync } from "node:zlib";

import {
  PdfError,
  deflateZlib,
  inflateZlib,
  writePdf,
  type PdfPage,
} from "./index.ts";

function pngChunk(kind: string, data: Uint8Array) {
  const body = Buffer.concat([Buffer.from(kind), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function makeRgbPng(
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
      pngChunk("IHDR", header),
      pngChunk(
        "IDAT",
        deflateSync(Buffer.concat(Array.from({ length: height }, () => row))),
      ),
      pngChunk("IEND", new Uint8Array()),
    ]),
  );
}

function makeRgbaPng(
  width: number,
  height: number,
  rgba: [number, number, number, number],
) {
  const row = Buffer.alloc(1 + width * 4);
  row[0] = 1; // Sub filter to exercise PNG unfiltering
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 4; c++) {
      const prev = x > 0 ? rgba[c]! : 0;
      row[1 + x * 4 + c] = (rgba[c]! - prev) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk(
        "IDAT",
        deflateSync(Buffer.concat(Array.from({ length: height }, () => row))),
      ),
      pngChunk("IEND", new Uint8Array()),
    ]),
  );
}

function makeMinimalJpeg(width: number, height: number) {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
}

test("deflateZlib and inflateZlib interoperate with node:zlib", () => {
  const sample = new TextEncoder().encode(
    "Hello PDF 1.4! ".repeat(64) + "Unique tail 12345",
  );
  const compressed = deflateZlib(sample);
  expect(new Uint8Array(inflateSync(compressed))).toEqual(sample);
  expect(inflateZlib(compressed)).toEqual(sample);

  const nodeCompressed = new Uint8Array(deflateSync(sample));
  expect(inflateZlib(nodeCompressed)).toEqual(sample);
});

test("writePdf produces deterministic PDF 1.4 bytes with shapes, text, gradients and images", () => {
  const rgbPng = makeRgbPng(16, 8, [109, 40, 217]);
  const rgbaPng = makeRgbaPng(10, 10, [14, 165, 233, 128]);
  const jpeg = makeMinimalJpeg(32, 24);

  const pages: PdfPage[] = [
    {
      width: 960,
      height: 540,
      background: "#FFFFFF",
      elements: [
        {
          type: "roundRect",
          x: 40,
          y: 40,
          w: 880,
          h: 460,
          radius: 16,
          fill: {
            type: "linear",
            angle: 135,
            stops: [
              { color: "#6D28D9", at: 0 },
              { color: "#0EA5E9", at: 100 },
            ],
          },
          border: { width: 2, color: "#1B1B1F", dash: "dash" },
        },
        {
          type: "ellipse",
          x: 700,
          y: 60,
          w: 120,
          h: 120,
          opacity: 0.75,
          fill: {
            type: "radial",
            stops: [
              { color: "#F59E0B", at: 0 },
              { color: "#FFFFFF", at: 100 },
            ],
          },
        },
        {
          type: "line",
          x1: 60,
          y1: 200,
          x2: 900,
          y2: 200,
          width: 1.5,
          color: "#6B7280",
          dash: "dot",
        },
        {
          type: "text",
          x: 60,
          y: 60,
          w: 600,
          h: 120,
          anchor: "middle",
          paragraphs: [
            {
              align: "left",
              runs: [
                {
                  text: "Slide Title: ",
                  size: 32,
                  bold: true,
                  color: "#1B1B1F",
                },
                {
                  text: "Wrapped & styled (italic)",
                  size: 24,
                  italic: true,
                  underline: true,
                  color: "#6D28D9",
                },
              ],
            },
            {
              align: "center",
              bullet: "•",
              indent: 20,
              runs: [
                {
                  text: "A long paragraph that wraps cleanly across lines inside its bounding box so every run is placed deterministically.",
                  size: 16,
                  bold: true,
                  italic: true,
                  strike: true,
                  color: "#374151",
                },
              ],
            },
          ],
        },
        {
          type: "image",
          x: 60,
          y: 240,
          w: 200,
          h: 100,
          data: rgbPng,
          fit: "contain",
        },
        {
          type: "image",
          x: 300,
          y: 240,
          w: 120,
          h: 120,
          data: rgbaPng,
          fit: "cover",
          radius: [12, 0, 12, 0],
          border: { width: 1, color: "#1B1B1F" },
        },
        {
          type: "image",
          x: 460,
          y: 240,
          w: 160,
          h: 120,
          data: jpeg,
          fit: "fill",
        },
      ],
    },
  ];

  const first = writePdf(pages);
  const second = writePdf(pages);
  expect(second).toEqual(first);

  const text = new TextDecoder("latin1").decode(first);
  expect(text.startsWith("%PDF-1.4\n")).toBe(true);
  expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  expect(text).toContain("/MediaBox [0 0 960 540]");
  expect(text).toContain("/BaseFont /Helvetica");
  expect(text).toContain("/BaseFont /Helvetica-Bold");
  expect(text).toContain("/BaseFont /Helvetica-Oblique");
  expect(text).toContain("/BaseFont /Helvetica-BoldOblique");
  expect(text).toContain("/Filter /FlateDecode");
  expect(text).toContain("/Filter /DCTDecode");
  expect(text).toContain("/SMask ");
  expect(text).toContain("(Slide Title: ) Tj");

  // Verify every xref entry points to the exact byte offset of its object.
  const xrefAt = Number(text.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  expect(xrefAt).toBeGreaterThan(0);
  expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
  const entries = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map(
    (m) => Number(m[1]),
  );
  expect(entries.length).toBeGreaterThanOrEqual(8);
  entries.forEach((offset, index) => {
    expect(text.slice(offset, offset + 12)).toStartWith(`${index + 1} 0 obj\n`);
  });
});

test("writePdf rejects empty page lists and corrupt images", () => {
  expect(() => writePdf([])).toThrow(PdfError);
  expect(() =>
    writePdf([
      {
        elements: [
          {
            type: "image",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            data: new Uint8Array([1, 2, 3, 4]),
          },
        ],
      },
    ]),
  ).toThrow(PdfError);
});
