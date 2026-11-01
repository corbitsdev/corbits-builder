import { crc32 } from "./crc32.ts";
import {
  CENTRAL_HEADER,
  CENTRAL_HEADER_SIZE,
  DEFLATED,
  END_OF_CENTRAL,
  END_RECORD_SIZE,
  LOCAL_HEADER,
  LOCAL_HEADER_SIZE,
  MAX_ENTRIES,
  MAX_UINT32,
  STORED,
  UTF8_NAMES,
  ZipError,
  checkName,
  concat,
} from "./format.ts";
import { deflateRaw } from "./streams.ts";

export type ZipEntry = { path: string; data: Uint8Array<ArrayBuffer> | string };

const VERSION = 20;
// 1980-01-01 00:00, the earliest DOS date.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

const encoder = new TextEncoder();

async function compress(raw: Uint8Array<ArrayBuffer>) {
  const packed = await deflateRaw(raw);
  return packed.length < raw.length
    ? { method: DEFLATED, body: packed }
    : { method: STORED, body: raw };
}

/**
 * Writes entries in the order given with fixed timestamps. Equal input gives equal bytes under one
 * deflate implementation; Bun and browsers can compress differently.
 */
export async function zip(
  entries: readonly ZipEntry[],
): Promise<Uint8Array<ArrayBuffer>> {
  if (entries.length > MAX_ENTRIES)
    throw new ZipError(`zip holds at most ${MAX_ENTRIES} entries`);
  const seen = new Set<string>();
  for (const { path } of entries) checkName(path, seen);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const prepared = await Promise.all(
    entries.map(async ({ path, data }) => {
      const raw = typeof data === "string" ? encoder.encode(data) : data;
      return { path, raw, ...(await compress(raw)) };
    }),
  );
  for (const { path, raw, method, body } of prepared) {
    const name = encoder.encode(path);
    if (raw.length >= MAX_UINT32 || offset >= MAX_UINT32)
      throw new ZipError(`${path} needs ZIP64, which is not written`);
    const crc = crc32(raw);

    const local = new DataView(new ArrayBuffer(LOCAL_HEADER_SIZE));
    local.setUint32(0, LOCAL_HEADER, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, method, true);
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const dir = new DataView(new ArrayBuffer(CENTRAL_HEADER_SIZE));
    dir.setUint32(0, CENTRAL_HEADER, true);
    dir.setUint16(4, VERSION, true);
    dir.setUint16(6, VERSION, true);
    dir.setUint16(8, UTF8_NAMES, true);
    dir.setUint16(10, method, true);
    dir.setUint16(12, DOS_TIME, true);
    dir.setUint16(14, DOS_DATE, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += LOCAL_HEADER_SIZE + name.length + body.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  if (offset >= MAX_UINT32 || centralSize >= MAX_UINT32)
    throw new ZipError("archive needs ZIP64, which is not written");
  const end = new DataView(new ArrayBuffer(END_RECORD_SIZE));
  end.setUint32(0, END_OF_CENTRAL, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return concat([...parts, ...central, new Uint8Array(end.buffer)]);
}
