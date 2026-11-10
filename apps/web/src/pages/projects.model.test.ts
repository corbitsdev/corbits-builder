import { expect, test } from "bun:test";
import { listedDirectory, readDirectory } from "../api/repository.ts";
import { folderReading } from "./projects.model.ts";

const listed = (path: string, text: string) => {
  const blob = new Blob([text]);
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    size: blob.size,
    webkitRelativePath: path,
    arrayBuffer: () => blob.arrayBuffer(),
  };
};

test("a folder that was read is put in the page's words", async () => {
  const picked = listedDirectory([
    listed("rtv7/package.json", '{"name":"rtv7"}'),
    listed("rtv7/.env", "TOKEN=1"),
    listed("rtv7/pnpm-lock.yaml", "lockfileVersion: 9"),
  ])!;
  const reading = await readDirectory(picked, new Set([".env"]));
  const { warnings, ...shown } = folderReading({
    picked,
    reading,
    choices: new Map([
      [".env", "secret"],
      ["pnpm-lock.yaml", "lockfile"],
    ]),
    excluded: new Set([".env"]),
  });
  expect(shown).toEqual({
    title: "Rtv7",
    folderName: "rtv7",
    code: { files: 2, size: "86 B" },
    found: [],
    toWrite: [
      "Problem brief",
      "Constraints",
      "Approaches",
      "Product requirements",
      "Design",
      "Build plan",
    ],
    empty: false,
    leaveOut: [
      { path: ".env", reason: "looks like a secret", leftOut: true },
      {
        path: "pnpm-lock.yaml",
        reason: "a lockfile Builder does not use",
        leftOut: false,
      },
    ],
  });
  expect(warnings).toEqual(reading.report.warnings);
});
