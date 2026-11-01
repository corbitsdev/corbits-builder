export const LOCAL_HEADER = 0x04034b50;
export const CENTRAL_HEADER = 0x02014b50;
export const END_OF_CENTRAL = 0x06054b50;
export const LOCAL_HEADER_SIZE = 30;
export const CENTRAL_HEADER_SIZE = 46;
export const END_RECORD_SIZE = 22;
export const STORED = 0;
export const DEFLATED = 8;
export const UTF8_NAMES = 0x0800;
export const MAX_UINT32 = 0xffffffff;
export const MAX_ENTRIES = 0xffff;

export class ZipError extends Error {
  override name = "ZipError";
}

const UNSAFE_NAME = /^$|^\/|^[A-Za-z]:|\\|\0|(^|\/)\.\.(\/|$)/;

/** Throws on a name that could escape the folder it is extracted into, or that repeats. */
export function checkName(path: string, seen: Set<string>) {
  if (UNSAFE_NAME.test(path)) throw new ZipError(`unsafe entry name "${path}"`);
  if (seen.has(path)) throw new ZipError(`duplicate entry name "${path}"`);
  seen.add(path);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
