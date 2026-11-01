import { concat } from "./format.ts";

export async function deflateRaw(data: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflates up to `limit` bytes, or returns undefined as soon as the output would pass it. */
export async function inflateRaw(data: Uint8Array<ArrayBuffer>, limit: number) {
  const reader = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    total += read.value.length;
    if (total > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(read.value);
  }
  return concat(chunks);
}
