import { expect, test } from "bun:test";
import { type } from "arktype";
import {
  ArtifactKindWrite,
  DesignBundle,
  DesignTweaks,
} from "@corbits-builder/schemas/artifact";
import { ProjectExportMaterial } from "@corbits-builder/schemas/project";
import { typeIssues } from "./errors.ts";

test("typeIssues names the rule for narrow checks, unions and extra keys without quoting submitted values", () => {
  const secret = "sk-live-secret-value-not-for-issues";
  const bundle = DesignBundle({ files: { "notes.txt": secret } });
  const tweaks = DesignTweaks({ tokens: {} });
  const write = ArtifactKindWrite({
    kind: secret,
    title: "Title",
    content: "Body",
    extra: secret,
  });
  const material = ProjectExportMaterial({
    title: "file",
    content: secret.repeat(8000),
  });
  if (
    !(bundle instanceof type.errors) ||
    !(tweaks instanceof type.errors) ||
    !(write instanceof type.errors) ||
    !(material instanceof type.errors)
  )
    throw new Error("expected validation errors");

  expect(typeIssues(bundle, "content")).toEqual([
    {
      path: "content.files",
      message: "must be a bundle with DESIGN.md and designs/index.html",
    },
  ]);
  expect(typeIssues(tweaks)).toEqual([
    { path: "tokens", message: "must be at least one token" },
  ]);
  expect(typeIssues(write)).toEqual([
    {
      path: "kind",
      message:
        "must be a document kind: a short lowercase slug such as build_plan",
    },
    { path: "extra", message: "is not allowed here" },
  ]);
  expect(typeIssues(material)).toEqual([
    { path: "content", message: "is not one of the allowed values" },
  ]);
  expect(
    JSON.stringify([
      typeIssues(bundle, "content"),
      typeIssues(tweaks),
      typeIssues(write),
      typeIssues(material),
    ]),
  ).not.toContain(secret);
});
