import { expect, test } from "bun:test";
import { describeBytes, listedDirectory, readDirectory } from "./repository.ts";

const listed = (path: string, text: string) => {
  const blob = new Blob([text]);
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    size: blob.size,
    webkitRelativePath: path,
    arrayBuffer: () => blob.arrayBuffer(),
  };
};

test("a folder input's files lose the folder's name and never include dependencies", async () => {
  const picked = listedDirectory([
    listed("rtv7/package.json", '{"name":"rtv7"}'),
    listed("rtv7/src/main.ts", "export {};"),
    listed("rtv7/node_modules/left/index.js", ""),
    listed("rtv7/.git/HEAD", "ref: refs/heads/main"),
  ])!;
  expect(picked.name).toBe("rtv7");
  expect(picked.files.map((file) => file.path)).toEqual([
    "package.json",
    "src/main.ts",
  ]);
  const { file, report } = await readDirectory(picked, new Set());
  expect(report.title).toBe("Rtv7");
  expect(file.documents.map((document) => document.kind)).toEqual(["app"]);
  expect(report.missing).toEqual([
    "problem_brief",
    "constraints",
    "approaches",
    "product_requirements",
    "design",
    "build_plan",
  ]);
});

test("an empty listing is no folder", () => {
  expect(listedDirectory([])).toBeUndefined();
});

test("sizes read as people do", () => {
  expect(describeBytes(512)).toBe("512 B");
  expect(describeBytes(20 * 1024)).toBe("20 KB");
  expect(describeBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
});
