import type { Box } from "./layouts.ts";

export type ImageFormat = "png" | "jpeg";
export type ImageInfo = { format: ImageFormat; width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function jpegSize(view: DataView) {
  for (let at = 2; at + 9 < view.byteLength;) {
    const marker = view.getUint8(at + 1);
    // Start-of-frame markers carry the size; C4, C8 and CC share the range but are not frames.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    )
      return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    at += 2 + view.getUint16(at + 2);
  }
  return undefined;
}

function readHeader(bytes: Uint8Array): ImageInfo | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  )
    return {
      format: "png",
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const size = jpegSize(view);
    return size && { format: "jpeg", ...size };
  }
  return undefined;
}

/** The format and pixel size from a PNG or JPEG header, or undefined when it is neither or has no area. */
export function readImage(bytes: Uint8Array): ImageInfo | undefined {
  const info = readHeader(bytes);
  return info && info.width > 0 && info.height > 0 ? info : undefined;
}

const PROLOG =
  /^\uFEFF?(?:\s|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>)*/;
const CHUNK = 4096;

/** Whether the document's root element is <svg>, decoding only as far as the end of the prolog. */
export function isSvg(bytes: Uint8Array) {
  const decoder = new TextDecoder();
  let text = "";
  for (let at = 0; at < bytes.length; at += CHUNK) {
    const end = at + CHUNK >= bytes.length;
    text += decoder.decode(bytes.subarray(at, at + CHUNK), { stream: !end });
    const rest = text.replace(PROLOG, "");
    // An unfinished comment, declaration or tag name needs the next chunk to decide.
    if (end || (rest.length > 4 && !/^<[?!]/.test(rest)))
      return /^<svg[\s/>]/.test(rest);
  }
  return false;
}

export function contain({ width, height }: ImageInfo, box: Box): Box {
  const scale = Math.min(box.w / width, box.h / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return {
    x: box.x + Math.round((box.w - w) / 2),
    y: box.y + Math.round((box.h - h) / 2),
    w,
    h,
  };
}

// Cover fills the box and crops the overflow evenly; srcRect is in thousandths of a percent per side.
export function coverCrop({ width, height }: ImageInfo, box: Box) {
  const visible = box.w / box.h / (width / height);
  const side = (fraction: number) => Math.round(((1 - fraction) / 2) * 100000);
  return visible < 1
    ? `<a:srcRect l="${side(visible)}" r="${side(visible)}"/>`
    : `<a:srcRect t="${side(1 / visible)}" b="${side(1 / visible)}"/>`;
}
