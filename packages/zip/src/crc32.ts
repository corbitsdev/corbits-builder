// A DataView read is always a number, where indexing the array is typed as possibly undefined.
const TABLE = new DataView(
  Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value;
  }).buffer,
);

export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data)
    crc = TABLE.getUint32(((crc ^ byte) & 0xff) * 4, true) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
