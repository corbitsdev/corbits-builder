import { PdfError, deflateZlib, inflateZlib } from "./zlib.ts";

export type PdfDecodedImage = {
  width: number;
  height: number;
  colorSpace: "DeviceRGB" | "DeviceGray";
  filter: "DCTDecode" | "FlateDecode";
  data: Uint8Array<ArrayBuffer>;
  smask?: Uint8Array<ArrayBuffer>;
};

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 24) return false;
  return PNG_SIG.every((b, idx) => bytes[idx] === b);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function decodeJpeg(bytes: Uint8Array): PdfDecodedImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 2; at + 9 < view.byteLength;) {
    if (view.getUint8(at) !== 0xff)
      throw new PdfError("corrupt JPEG marker prefix");
    const marker = view.getUint8(at + 1);
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const segLen = view.getUint16(at + 2);
    if (segLen < 2 || at + 2 + segLen > view.byteLength)
      throw new PdfError("truncated JPEG segment");
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      const height = view.getUint16(at + 5);
      const width = view.getUint16(at + 7);
      const components = view.getUint8(at + 9);
      if (width === 0 || height === 0)
        throw new PdfError("JPEG has zero dimensions");
      const colorSpace = components === 1 ? "DeviceGray" : "DeviceRGB";
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return {
        width,
        height,
        colorSpace,
        filter: "DCTDecode",
        data: copy,
      };
    }
    at += 2 + segLen;
  }
  throw new PdfError("JPEG has no start-of-frame header");
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterRow(
  filterType: number,
  raw: Uint8Array,
  rowStart: number,
  prev: Uint8Array,
  curr: Uint8Array,
  bpp: number,
) {
  for (let i = 0; i < curr.length; i++) {
    const x = raw[rowStart + i]!;
    const left = i >= bpp ? curr[i - bpp]! : 0;
    const up = prev[i]!;
    const upLeft = i >= bpp ? prev[i - bpp]! : 0;
    if (filterType === 0) curr[i] = x;
    else if (filterType === 1) curr[i] = (x + left) & 0xff;
    else if (filterType === 2) curr[i] = (x + up) & 0xff;
    else if (filterType === 3) curr[i] = (x + ((left + up) >> 1)) & 0xff;
    else if (filterType === 4)
      curr[i] = (x + paethPredictor(left, up, upLeft)) & 0xff;
    else throw new PdfError(`unsupported PNG filter ${filterType}`);
  }
}

function unfilterPng(
  raw: Uint8Array,
  width: number,
  height: number,
  bpp: number,
): Uint8Array {
  const stride = width * bpp;
  if (raw.length < height * (1 + stride))
    throw new PdfError("PNG image data is shorter than expected scanlines");
  const pixels = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + stride);
    const filterType = raw[rowOffset]!;
    const curr = pixels.subarray(y * stride, (y + 1) * stride);
    unfilterRow(filterType, raw, rowOffset + 1, prev, curr, bpp);
    prev = curr;
  }
  return pixels;
}

function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
    case 3:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new PdfError(`unsupported PNG color type ${colorType}`);
  }
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function splitPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  colorType: number,
  palette?: Uint8Array,
  trns?: Uint8Array,
) {
  const count = width * height;
  if (colorType === 2) return { rgb: pixels, alpha: undefined };
  const rgb = new Uint8Array(count * 3);
  if (colorType === 0) {
    for (let i = 0; i < count; i++) {
      const v = pixels[i]!;
      rgb[i * 3] = v;
      rgb[i * 3 + 1] = v;
      rgb[i * 3 + 2] = v;
    }
    return { rgb, alpha: undefined };
  }
  if (colorType === 3) {
    if (!palette) throw new PdfError("indexed PNG is missing PLTE chunk");
    const alpha = trns ? new Uint8Array(count) : undefined;
    for (let i = 0; i < count; i++) {
      const idx = pixels[i]!;
      if ((idx + 1) * 3 > palette.length)
        throw new PdfError("PNG palette index out of bounds");
      rgb[i * 3] = palette[idx * 3]!;
      rgb[i * 3 + 1] = palette[idx * 3 + 1]!;
      rgb[i * 3 + 2] = palette[idx * 3 + 2]!;
      if (alpha && trns) alpha[i] = trns[idx] ?? 255;
    }
    return { rgb, alpha };
  }
  const alpha = new Uint8Array(count);
  if (colorType === 4) {
    for (let i = 0; i < count; i++) {
      const v = pixels[i * 2]!;
      rgb[i * 3] = v;
      rgb[i * 3 + 1] = v;
      rgb[i * 3 + 2] = v;
      alpha[i] = pixels[i * 2 + 1]!;
    }
    return { rgb, alpha };
  }
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = pixels[i * 4]!;
    rgb[i * 3 + 1] = pixels[i * 4 + 1]!;
    rgb[i * 3 + 2] = pixels[i * 4 + 2]!;
    alpha[i] = pixels[i * 4 + 3]!;
  }
  return { rgb, alpha };
}

function decodePng(bytes: Uint8Array): PdfDecodedImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idats: Uint8Array[] = [];

  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(
      bytes[at + 4]!,
      bytes[at + 5]!,
      bytes[at + 6]!,
      bytes[at + 7]!,
    );
    const dataStart = at + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length)
      throw new PdfError(`truncated PNG chunk ${type}`);
    const chunkData = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (length < 13) throw new PdfError("PNG IHDR chunk is too short");
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      interlace = bytes[dataStart + 12]!;
    } else if (type === "PLTE") {
      palette = chunkData;
    } else if (type === "tRNS") {
      trns = chunkData;
    } else if (type === "IDAT") {
      idats.push(chunkData);
    } else if (type === "IEND") {
      break;
    }
    at = dataEnd + 4;
  }

  if (width === 0 || height === 0)
    throw new PdfError("PNG has zero dimensions");
  if (bitDepth !== 8)
    throw new PdfError(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0)
    throw new PdfError("interlaced PNG images are not supported");
  if (idats.length === 0) throw new PdfError("PNG has no IDAT chunks");

  const channels = channelsForColorType(colorType);
  const inflated = inflateZlib(concatChunks(idats));
  const pixels = unfilterPng(inflated, width, height, channels);
  const { rgb, alpha } = splitPixels(
    pixels,
    width,
    height,
    colorType,
    palette,
    trns,
  );
  return {
    width,
    height,
    colorSpace: "DeviceRGB",
    filter: "FlateDecode",
    data: deflateZlib(rgb),
    ...(alpha ? { smask: deflateZlib(alpha) } : {}),
  };
}

export function decodePdfImage(bytes: Uint8Array): PdfDecodedImage {
  if (isPng(bytes)) return decodePng(bytes);
  if (isJpeg(bytes)) return decodeJpeg(bytes);
  throw new PdfError("image is not a valid PNG or JPEG");
}
