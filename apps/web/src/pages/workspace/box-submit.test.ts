import { describe, expect, mock, test } from "bun:test";
import { submit, type SendTo } from "./box-submit.ts";

const nowhere = (): SendTo => ({
  files: false,
  comments: null,
  shell: undefined,
  screen: undefined,
  message: mock(() => {}),
});

const screen = (label: string | null, took = true) => ({
  take: mock((_words: string) => took),
  label,
});

describe("submit", () => {
  test("words with nothing else waiting go to the coordinator", () => {
    const to = nowhere();
    expect(submit("hello", to)).toBe("message");
    expect(to.message).toHaveBeenCalledTimes(1);
  });

  test("with nothing typed, Send sends the comments on their own", () => {
    const comments = mock((_words?: string) => {});
    expect(submit("  ", { ...nowhere(), comments })).toBe("comments");
    expect(comments).toHaveBeenCalledWith();
  });

  test("the shell's question takes the text before a screen or the comments", () => {
    const comments = mock((_words?: string) => {});
    const offer = screen(null);
    const to = { ...nowhere(), comments, screen: offer, shell: () => true };
    expect(submit("yes", to)).toBe("shell");
    expect(offer.take).not.toHaveBeenCalled();
    expect(comments).not.toHaveBeenCalled();
  });

  test("a screen in the box takes the words with its pick", () => {
    const offer = screen(null);
    expect(submit(" blue ", { ...nowhere(), screen: offer })).toBe("screen");
    expect(offer.take).toHaveBeenCalledWith("blue");
  });

  test("with nothing typed, a screen takes Send only with a label of its own", () => {
    const unlabelled = screen(null);
    expect(submit("", { ...nowhere(), screen: unlabelled })).toBe("message");
    expect(unlabelled.take).not.toHaveBeenCalled();
    const labelled = screen("Send feedback · 2 comments");
    expect(submit("", { ...nowhere(), screen: labelled })).toBe("screen");
    expect(labelled.take).toHaveBeenCalledWith("");
  });

  test("words a screen turns down go out with the comments", () => {
    const comments = mock((_words?: string) => {});
    const to = { ...nowhere(), comments, screen: screen(null, false) };
    expect(submit("fix these", to)).toBe("comments");
    expect(comments).toHaveBeenCalledWith("fix these");
  });

  test("with files attached, everything goes as one message", () => {
    const comments = mock((_words?: string) => {});
    const shell = mock(() => true);
    const offer = screen("Send feedback · 1 comment");
    const to = { ...nowhere(), files: true, comments, shell, screen: offer };
    expect(submit("", to)).toBe("message");
    expect(comments).not.toHaveBeenCalled();
    expect(shell).not.toHaveBeenCalled();
    expect(offer.take).not.toHaveBeenCalled();
  });
});
