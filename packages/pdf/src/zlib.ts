export class PdfError extends Error {
  override name = "PdfError";
}

const ADLER_MOD = 65521;

export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length;) {
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i]!;
      b += a;
    }
    a %= ADLER_MOD;
    b %= ADLER_MOD;
  }
  return ((b << 16) | a) >>> 0;
}

class BitWriter {
  readonly #bytes: number[] = [];
  #buf = 0;
  #bits = 0;

  writeBits(value: number, count: number) {
    this.#buf |= value << this.#bits;
    this.#bits += count;
    while (this.#bits >= 8) {
      this.#bytes.push(this.#buf & 0xff);
      this.#buf >>>= 8;
      this.#bits -= 8;
    }
  }

  writeHuffman(code: number, length: number) {
    let rev = 0;
    for (let i = 0; i < length; i++) rev = (rev << 1) | ((code >>> i) & 1);
    this.writeBits(rev, length);
  }

  flushByte() {
    if (this.#bits > 0) {
      this.#bytes.push(this.#buf & 0xff);
      this.#buf = 0;
      this.#bits = 0;
    }
  }

  writeUint32BE(value: number) {
    this.flushByte();
    this.#bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }

  toUint8Array(): Uint8Array<ArrayBuffer> {
    this.flushByte();
    return new Uint8Array(this.#bytes);
  }
}

function writeFixedLiteral(writer: BitWriter, symbol: number) {
  if (symbol <= 143) writer.writeHuffman(0x30 + symbol, 8);
  else if (symbol <= 255) writer.writeHuffman(0x190 + (symbol - 144), 9);
  else if (symbol <= 279) writer.writeHuffman(symbol - 256, 7);
  else writer.writeHuffman(0xc0 + (symbol - 280), 8);
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
];

function findSlot(table: readonly number[], value: number) {
  let slot = 0;
  for (let i = 0; i < table.length; i++) {
    if (table[i]! <= value) slot = i;
    else break;
  }
  return slot;
}

function writeMatch(writer: BitWriter, length: number, distance: number) {
  const lenSlot = findSlot(LENGTH_BASE, length);
  writeFixedLiteral(writer, 257 + lenSlot);
  const lenExtra = LENGTH_EXTRA[lenSlot]!;
  if (lenExtra > 0) writer.writeBits(length - LENGTH_BASE[lenSlot]!, lenExtra);

  const distSlot = findSlot(DIST_BASE, distance);
  writer.writeHuffman(distSlot, 5);
  const distExtra = DIST_EXTRA[distSlot]!;
  if (distExtra > 0)
    writer.writeBits(distance - DIST_BASE[distSlot]!, distExtra);
}

function hash3(data: Uint8Array, pos: number) {
  return ((data[pos]! << 10) ^ (data[pos + 1]! << 5) ^ data[pos + 2]!) & 0x3fff;
}

function matchLength(data: Uint8Array, a: number, b: number, maxLen: number) {
  let len = 0;
  while (len < maxLen && data[a + len] === data[b + len]) len++;
  return len;
}

/** Deterministic RFC 1950 zlib compressor using LZ77 and fixed Huffman coding. */
export function deflateZlib(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const writer = new BitWriter();
  // Zlib header: CMF = 0x78 (Deflate, 32K window), FLG = 0x9C (default compression, valid check)
  writer.writeBits(0x78, 8);
  writer.writeBits(0x9c, 8);
  // Final block (BFINAL=1), Fixed Huffman (BTYPE=01)
  writer.writeBits(1, 1);
  writer.writeBits(1, 2);

  const head = new Int32Array(16384).fill(-1);
  let pos = 0;
  while (pos < data.length) {
    if (pos + 3 <= data.length) {
      const h = hash3(data, pos);
      const prev = head[h]!;
      head[h] = pos;
      const dist = pos - prev;
      if (prev >= 0 && dist <= 32768) {
        const len = matchLength(
          data,
          prev,
          pos,
          Math.min(258, data.length - pos),
        );
        if (len >= 3) {
          writeMatch(writer, len, dist);
          for (
            let step = 1;
            step < len && pos + step + 3 <= data.length;
            step++
          )
            head[hash3(data, pos + step)] = pos + step;
          pos += len;
          continue;
        }
      }
    }
    writeFixedLiteral(writer, data[pos]!);
    pos++;
  }
  writeFixedLiteral(writer, 256);
  writer.writeUint32BE(adler32(data));
  return writer.toUint8Array();
}

type HuffmanTree = { counts: Uint16Array; symbols: Uint16Array };

function buildTree(lengths: Uint8Array): HuffmanTree {
  const counts = new Uint16Array(16);
  for (const len of lengths) if (len > 0) counts[len]!++;
  const offsets = new Uint16Array(16);
  let total = 0;
  for (let bits = 1; bits <= 15; bits++) {
    offsets[bits] = total;
    total += counts[bits]!;
  }
  const symbols = new Uint16Array(total);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym]!;
    if (len > 0) {
      const at = offsets[len]!;
      symbols[at] = sym;
      offsets[len] = at + 1;
    }
  }
  return { counts, symbols };
}

function buildFixedTrees() {
  const litLengths = new Uint8Array(288);
  litLengths.fill(8, 0, 144);
  litLengths.fill(9, 144, 256);
  litLengths.fill(7, 256, 280);
  litLengths.fill(8, 280, 288);
  const distLengths = new Uint8Array(32).fill(5);
  return { litTree: buildTree(litLengths), distTree: buildTree(distLengths) };
}

const FIXED_TREES = buildFixedTrees();
const CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

class BitReader {
  #pos: number;
  #buf = 0;
  #bits = 0;

  constructor(
    readonly data: Uint8Array,
    start: number,
  ) {
    this.#pos = start;
  }

  readBits(count: number): number {
    while (this.#bits < count) {
      if (this.#pos >= this.data.length)
        throw new PdfError("unexpected end of zlib stream");
      this.#buf |= this.data[this.#pos]! << this.#bits;
      this.#pos++;
      this.#bits += 8;
    }
    const out = this.#buf & ((1 << count) - 1);
    this.#buf >>>= count;
    this.#bits -= count;
    return out;
  }

  alignByte() {
    this.#buf = 0;
    this.#bits = 0;
  }

  readBytes(count: number): Uint8Array {
    this.alignByte();
    if (this.#pos + count > this.data.length)
      throw new PdfError("unexpected end of stored deflate block");
    const slice = this.data.subarray(this.#pos, this.#pos + count);
    this.#pos += count;
    return slice;
  }

  decodeSymbol(tree: HuffmanTree): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= this.readBits(1);
      const count = tree.counts[len]!;
      if (code - count < first) return tree.symbols[index + (code - first)]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new PdfError("invalid Huffman code in zlib stream");
  }
}

function readRepeatCount(reader: BitReader, sym: number): number {
  if (sym === 16) return 3 + reader.readBits(2);
  if (sym === 17) return 3 + reader.readBits(3);
  return 11 + reader.readBits(7);
}

function readDynamicTrees(reader: BitReader) {
  const hlit = reader.readBits(5) + 257;
  const hdist = reader.readBits(5) + 1;
  const hclen = reader.readBits(4) + 4;
  const codeLengths = new Uint8Array(19);
  for (let i = 0; i < hclen; i++)
    codeLengths[CODE_LENGTH_ORDER[i]!] = reader.readBits(3);
  const codeTree = buildTree(codeLengths);

  const lengths = new Uint8Array(hlit + hdist);
  for (let i = 0; i < lengths.length;) {
    const sym = reader.decodeSymbol(codeTree);
    if (sym <= 15) {
      lengths[i++] = sym;
      continue;
    }
    const repeat = readRepeatCount(reader, sym);
    const previous = i > 0 ? lengths[i - 1] : undefined;
    const fill = sym === 16 && previous !== undefined ? previous : 0;
    lengths.fill(fill, i, i + repeat);
    i += repeat;
  }
  return {
    litTree: buildTree(lengths.subarray(0, hlit)),
    distTree: buildTree(lengths.subarray(hlit)),
  };
}

function inflateHuffmanBlock(
  reader: BitReader,
  litTree: HuffmanTree,
  distTree: HuffmanTree,
  out: number[],
) {
  for (;;) {
    const sym = reader.decodeSymbol(litTree);
    if (sym === 256) return;
    if (sym < 256) {
      out.push(sym);
      continue;
    }
    const lenSlot = sym - 257;
    const length =
      LENGTH_BASE[lenSlot]! + reader.readBits(LENGTH_EXTRA[lenSlot]!);
    const distSlot = reader.decodeSymbol(distTree);
    const distance =
      DIST_BASE[distSlot]! + reader.readBits(DIST_EXTRA[distSlot]!);
    const start = out.length - distance;
    if (start < 0) throw new PdfError("invalid deflate distance");
    for (let i = 0; i < length; i++) out.push(out[start + i]!);
  }
}

/** Decompresses an RFC 1950 zlib stream and checks its Adler-32 checksum. */
export function inflateZlib(data: Uint8Array): Uint8Array<ArrayBuffer> {
  if (data.length < 6) throw new PdfError("zlib stream is too short");
  const cmf = data[0]!;
  const flg = data[1]!;
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) + flg) % 31 !== 0 || (flg & 0x20) !== 0)
    throw new PdfError("invalid zlib header");

  const reader = new BitReader(data.subarray(0, data.length - 4), 2);
  const out: number[] = [];
  for (let final = 0; final === 0;) {
    final = reader.readBits(1);
    const btype = reader.readBits(2);
    if (btype === 0) {
      const header = reader.readBytes(4);
      const len = header[0]! | (header[1]! << 8);
      const nlen = header[2]! | (header[3]! << 8);
      if ((len ^ 0xffff) !== nlen)
        throw new PdfError("corrupt stored deflate block length");
      const raw = reader.readBytes(len);
      for (let i = 0; i < raw.length; i++) out.push(raw[i]!);
    } else if (btype === 1) {
      inflateHuffmanBlock(
        reader,
        FIXED_TREES.litTree,
        FIXED_TREES.distTree,
        out,
      );
    } else if (btype === 2) {
      const { litTree, distTree } = readDynamicTrees(reader);
      inflateHuffmanBlock(reader, litTree, distTree, out);
    } else {
      throw new PdfError("invalid deflate block type");
    }
  }
  const result = new Uint8Array(out);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const expected = view.getUint32(data.byteLength - 4);
  if (adler32(result) !== expected)
    throw new PdfError("zlib checksum mismatch");
  return result;
}
