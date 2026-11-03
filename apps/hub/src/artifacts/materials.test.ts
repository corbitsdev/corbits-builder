import { expect, test } from "bun:test";
import { mailAttachmentName } from "./materials.ts";

test("a mailed attachment's name is the person's, made US-ASCII", () => {
  // macOS names a screenshot with a narrow no-break space before AM.
  expect(
    mailAttachmentName("Screenshot 2026-11-03 at 8.51.17\u202fAM.png"),
  ).toBe("Screenshot 2026-11-03 at 8.51.17 AM.png");
  expect(mailAttachmentName("r\u00e9sum\u00e9 \u2014 final.pdf")).toBe(
    "resume  final.pdf",
  );
  expect(mailAttachmentName('say "hi".txt')).toBe("say 'hi'.txt");
  expect(mailAttachmentName("plain-name.png")).toBe("plain-name.png");
  expect(mailAttachmentName("\u5831\u544a.pdf")).toBe(".pdf");
});
