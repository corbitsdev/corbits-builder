import { expect, test } from "bun:test";
import { pastedFiles, pastedName } from "./pasted-files.ts";

const at = new Date("2026-11-04T10:52:07.000Z");

test("a clipboard picture gets a stamped name; a named file keeps its own", () => {
  const picture = new File([new Uint8Array([137, 80, 78, 71])], "image.png", {
    type: "image/png",
  });
  const report = new File(["hi"], "report.pdf", { type: "application/pdf" });
  const [first, second] = pastedFiles({ files: [picture, report] }, at);
  expect(first?.name).toBe("pasted-2026-11-04-10-52-07.png");
  expect(first?.type).toBe("image/png");
  expect(second?.name).toBe("report.pdf");
});

test("two pictures in one paste get different names, and a text paste yields none", () => {
  const picture = () =>
    new File([new Uint8Array([1])], "image.png", { type: "image/png" });
  const names = pastedFiles({ files: [picture(), picture()] }, at).map(
    (f) => f.name,
  );
  expect(new Set(names).size).toBe(2);
  expect(pastedFiles({ files: [] }, at)).toEqual([]);
  expect(pastedFiles(null, at)).toEqual([]);
  expect(pastedName("application/octet-stream", at)).toBe(
    "pasted-2026-11-04-10-52-07",
  );
});
