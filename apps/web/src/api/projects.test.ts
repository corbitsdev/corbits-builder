import { expect, test } from "bun:test";
import JSZip from "jszip";
import { wording } from "../config.ts";
import { readImportFile } from "./projects.ts";

test("a zip whose project.json is damaged is refused as an invalid import", async () => {
  const zip = new JSZip();
  zip.file("project.json", JSON.stringify({ padding: "x".repeat(5000) }), {
    compression: "DEFLATE",
  });
  const archive = await zip.generateAsync({ type: "arraybuffer" });
  const bytes = new Uint8Array(archive);
  // Inside the deflated entry, past its header: the archive still opens.
  for (let at = 45; at < 60; at++) bytes[at] = (bytes[at] ?? 0) ^ 0xff;

  await expect(readImportFile(new Blob([archive]))).rejects.toThrow(
    wording.importProject.invalid,
  );
});
