import { crc32 } from "./crc32.ts";
import {
  CENTRAL_HEADER,
  CENTRAL_HEADER_SIZE,
  DEFLATED,
  END_OF_CENTRAL,
  END_RECORD_SIZE,
  LOCAL_HEADER,
  LOCAL_HEADER_SIZE,
  MAX_UINT32,
  STORED,
  UTF8_NAMES,
  ZipError,
  checkName,
} from "./format.ts";
import { inflateRaw } from "./streams.ts";

export type UnzippedEntry = { path: string; data: Uint8Array<ArrayBuffer> };
export type UnzipOptions = { maxTotalBytes?: number };

const MAX_COMMENT = 0xffff;
const ENCRYPTED = 0x1;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

type Header = {
  path: string;
  method: number;
  crc: number;
  packedSize: number;
  size: number;
  start: number;
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodeName(bytes: Uint8Array, flags: number) {
  if (!(flags & UTF8_NAMES)) return String.fromCharCode(...bytes);
  try {
    return utf8.decode(bytes);
  } catch (cause) {
    throw new ZipError("entry name is not valid UTF-8", { cause });
  }
}

function endRecordOffset(view: DataView) {
  const last = view.byteLength - END_RECORD_SIZE;
  for (let at = last; at >= Math.max(0, last - MAX_COMMENT); at--)
    if (view.getUint32(at, true) === END_OF_CENTRAL) return at;
  throw new ZipError("not a zip: no end of central directory record");
}

function readHeaders(bytes: Uint8Array<ArrayBuffer>, view: DataView): Header[] {
  const end = endRecordOffset(view);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryAt = view.getUint32(end + 16, true);
  if (directoryAt === MAX_UINT32)
    throw new ZipError("ZIP64 archives are not read");
  const directoryEnd = directoryAt + directorySize;
  if (directoryEnd > end)
    throw new ZipError("central directory runs past its end record");
  if (count * CENTRAL_HEADER_SIZE > directorySize)
    throw new ZipError(`central directory is too small for ${count} entries`);

  const seen = new Set<string>();
  const headers: Header[] = [];
  let at = directoryAt;
  for (let index = 0; index < count; index++) {
    if (
      at + CENTRAL_HEADER_SIZE > directoryEnd ||
      view.getUint32(at, true) !== CENTRAL_HEADER
    )
      throw new ZipError(`central directory entry ${index} is corrupt`);
    const flags = view.getUint16(at + 8, true);
    const nameEnd = at + CENTRAL_HEADER_SIZE + view.getUint16(at + 28, true);
    const next =
      nameEnd + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (next > directoryEnd)
      throw new ZipError(`central directory entry ${index} is truncated`);
    const path = decodeName(
      bytes.subarray(at + CENTRAL_HEADER_SIZE, nameEnd),
      flags,
    );
    checkName(path, seen);
    if (flags & ENCRYPTED) throw new ZipError(`${path} is encrypted`);

    const packedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const localAt = view.getUint32(at + 42, true);
    if ([packedSize, size, localAt].includes(MAX_UINT32))
      throw new ZipError(`${path} needs ZIP64, which is not read`);
    if (
      localAt + LOCAL_HEADER_SIZE > directoryAt ||
      view.getUint32(localAt, true) !== LOCAL_HEADER
    )
      throw new ZipError(`${path} has no local header`);
    // The local header's own name and extra lengths can differ from the central directory's.
    const start =
      localAt +
      LOCAL_HEADER_SIZE +
      view.getUint16(localAt + 26, true) +
      view.getUint16(localAt + 28, true);
    if (start + packedSize > directoryAt)
      throw new ZipError(`${path} runs into the central directory`);
    headers.push({
      path,
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      packedSize,
      size,
      start,
    });
    at = next;
  }
  return headers;
}

function checkNoOverlap(headers: readonly Header[]) {
  const ranges = headers
    .map(({ start, packedSize }) => ({ start, end: start + packedSize }))
    .sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  for (const { start, end } of ranges) {
    if (start < previousEnd)
      throw new ZipError("entries overlap in the archive");
    previousEnd = end;
  }
}

async function inflate(
  { path, method, size }: Header,
  body: Uint8Array<ArrayBuffer>,
) {
  if (method === STORED) return body;
  if (method !== DEFLATED)
    throw new ZipError(`${path} uses unsupported compression method ${method}`);
  try {
    return await inflateRaw(body, size);
  } catch (cause) {
    throw new ZipError(`${path} is not valid deflate data`, { cause });
  }
}

/** Reads every entry in central directory order, checking names, bounds, sizes and CRCs. */
export async function unzip(
  bytes: Uint8Array<ArrayBuffer>,
  { maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES }: UnzipOptions = {},
): Promise<UnzippedEntry[]> {
  if (bytes.length < END_RECORD_SIZE)
    throw new ZipError("not a zip: too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headers = readHeaders(bytes, view);
  checkNoOverlap(headers);
  const total = headers.reduce((sum, { size }) => sum + size, 0);
  if (total > maxTotalBytes)
    throw new ZipError(
      `archive expands to ${total} bytes, over the ${maxTotalBytes} limit`,
    );

  const entries: UnzippedEntry[] = [];
  for (const header of headers) {
    const { path, crc, packedSize, size, start } = header;
    const data = await inflate(
      header,
      bytes.subarray(start, start + packedSize),
    );
    if (data === undefined || data.length !== size || crc32(data) !== crc)
      throw new ZipError(`${path} fails its size or CRC check`);
    entries.push({ path, data });
  }
  return entries;
}
