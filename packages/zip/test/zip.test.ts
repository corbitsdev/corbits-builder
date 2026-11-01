import { expect, test } from "bun:test";

import { ZipError, unzip, zip } from "../src/index.ts";

const centralDirectoryOffset = (archive: Uint8Array<ArrayBuffer>) =>
  new DataView(archive.buffer).getUint32(archive.length - 6, true);

async function patched(
  path: string,
  data: string,
  patch: (view: DataView, at: number) => void,
) {
  const archive = await zip([{ path, data }]);
  patch(new DataView(archive.buffer), centralDirectoryOffset(archive));
  return archive;
}

test("hostile archives fail with a ZipError", async () => {
  const bomb = await patched("bomb", "\0".repeat(1 << 20), (view, at) =>
    view.setUint32(at + 24, 16, true),
  );
  const outOfRange = await patched("a", "hello", (view, at) =>
    view.setUint32(at + 42, 0x7fffffff, true),
  );
  const traversal = await patched("xx/evil", "hello", (view, at) => {
    for (const offset of [30, at + 46]) {
      view.setUint8(offset, 0x2e);
      view.setUint8(offset + 1, 0x2e);
    }
  });
  const whole = await zip([{ path: "a", data: "hello" }]);

  for (const archive of [
    bomb,
    outOfRange,
    traversal,
    whole.slice(0, whole.length - 8),
  ])
    await expect(unzip(archive)).rejects.toBeInstanceOf(ZipError);
  for (const path of ["../evil", "/etc/passwd", "C:/x", "a\\b"])
    await expect(zip([{ path, data: "" }])).rejects.toBeInstanceOf(ZipError);
  await expect(
    zip([
      { path: "a", data: "" },
      { path: "a", data: "" },
    ]),
  ).rejects.toBeInstanceOf(ZipError);
});
