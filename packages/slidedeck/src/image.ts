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
