import { afterEach, expect, spyOn, test } from "bun:test";
import { openMicrophone } from "./dictation.tsx";

const realNavigator = globalThis.navigator;
const realAudioContext = globalThis.AudioContext;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: realNavigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    value: realAudioContext,
    configurable: true,
  });
});

test("a level meter that fails after the microphone opens stops the microphone", async () => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => (stopped += 1) }] };
  Object.defineProperty(globalThis, "navigator", {
    value: { mediaDevices: { getUserMedia: async () => stream } },
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    value: class {
      constructor() {
        throw new DOMException("no audio output", "NotSupportedError");
      }
    },
    configurable: true,
  });
  const warn = spyOn(console, "warn").mockImplementation(() => {});

  expect(await openMicrophone()).toBeNull();
  expect(stopped).toBe(1);
  warn.mockRestore();
});
