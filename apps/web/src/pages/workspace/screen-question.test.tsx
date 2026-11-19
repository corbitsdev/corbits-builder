import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScreenActionBuilder } from "@corbits-builder/plugin";
import publish from "@plugins/publish/package.json";
import { Output } from "@plugins/designer/src/pick-colours/schema.ts";
import takeDown, {
  text as takeDownText,
} from "@plugins/publish/src/take-down/definition.ts";
import TakeDownView from "@plugins/publish/src/take-down/view.tsx";
import { wording } from "../../config.ts";
import { storySupplies } from "./screen-story.tsx";
import { ScreenQuestion, draftOf, screenHost } from "./screen-question.tsx";

describe("a screen's stored draft", () => {
  const read = draftOf(Output);

  test("keeps a draft with fields still to choose, and a whole answer", () => {
    expect(read({ primary: "#1d4ed8" })).toEqual({ primary: "#1d4ed8" });
    expect(read({})).toEqual({});
    expect(read({ primary: "#1d4ed8", background: "#ffffff" })).toEqual({
      primary: "#1d4ed8",
      background: "#ffffff",
    });
  });

  test("keeps unfinished text rather than silently restoring the previous colour", () => {
    expect(read({ primary: "#12" })).toEqual({ primary: "#12" });
    expect(read({ primary: "" })).toEqual({ primary: "" });
  });

  test("drops drafts with the wrong shape", () => {
    expect(read({ primary: "#1d4ed8", shade: "dark" })).toBeUndefined();
    expect(read(["#1d4ed8"])).toBeUndefined();
    expect(read("#1d4ed8")).toBeUndefined();
  });
});

describe("an answered screen", () => {
  const host = screenHost(
    "@corbits-builder/publish take-down",
    ScreenActionBuilder.assert(publish.builder.actions["take-down"]),
    { screen: takeDown, view: TakeDownView, data: undefined },
  );
  const answered = (output: Record<string, unknown>) =>
    renderToStaticMarkup(
      <ScreenQuestion
        signalName="take-down"
        host={host}
        input={{ plan: "publish-to-server" }}
        projectValues={{ read: () => Promise.resolve({}) }}
        answer={{ output }}
        disabled={false}
        onAnswer={() => Promise.resolve(true)}
        supplies={storySupplies}
      />,
    );

  // Taking the app down leaves nothing to take down, which the question needed when it was asked.
  test("reads as what it asked and what was chosen, though it could not be asked now", () => {
    for (const [output, chose] of [
      [
        { agreed: { target: "server", release: "2026-11-17T10:00:00.000Z" } },
        takeDownText.agreed,
      ],
      [{ agreed: null }, takeDownText.kept],
    ] as const) {
      const html = answered(output);
      expect(html).toContain(wording.questions.screenAnswered);
      expect(html).toContain(takeDownText.title);
      expect(html).toContain(chose);
      expect(html).not.toContain(wording.questions.screenUnavailable);
    }
  });
});
