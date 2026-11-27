import { expect, test } from "bun:test";
import { pastedFiles, pastedName } from "./pasted-files.ts";

const at = new Date("2026-11-04T10:52:07.000Z");
const picture = () =>
  new File([new Uint8Array([137, 80, 78, 71])], "image.png", {
    type: "image/png",
  });
const clipboard = (files: File[], text = "") => ({
  files,
  getData: (type: string) => (type === "text/plain" ? text : ""),
});

test("a clipboard picture gets a stamped name; a named file keeps its own", () => {
  const report = new File(["hi"], "report.pdf", { type: "application/pdf" });
  const [first, second] = pastedFiles(clipboard([picture(), report]), at);
  expect(first?.name).toMatch(/^pasted-2026-11-04-10-52-07-\d+\.png$/);
  expect(first?.type).toBe("image/png");
  expect(second?.name).toBe("report.pdf");
});

test("every pasted picture gets its own name, even within one second", () => {
  const names = [
    ...pastedFiles(clipboard([picture(), picture()]), at),
    ...pastedFiles(clipboard([picture()]), at),
  ].map((file) => file.name);
  expect(new Set(names).size).toBe(3);
});

test("a paste that carries text is left to the browser, and an empty one yields nothing", () => {
  expect(pastedFiles(clipboard([picture()], "A1\tB1"), at)).toEqual([]);
  expect(pastedFiles(clipboard([]), at)).toEqual([]);
  expect(pastedFiles(null, at)).toEqual([]);
  expect(pastedName("application/octet-stream", at, 7)).toBe(
    "pasted-2026-11-04-10-52-07-7",
  );
});
