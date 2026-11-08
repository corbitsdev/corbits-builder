import { afterEach, expect, spyOn, test } from "bun:test";
import {
  createElement,
  Fragment,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToString } from "react-dom/server";
import { Dictated, openMicrophone } from "./dictation.tsx";

const realNavigator = globalThis.navigator;
const realAudioContext = globalThis.AudioContext;
const realWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: realNavigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    value: realAudioContext,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: realWindow,
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

test("a dictation started while another waits for its microphone closes the first microphone", async () => {
  const microphones: Array<(stream: MediaStream) => void> = [];
  let firstMicrophoneStops = 0;
  const recognitions: Array<{ started: boolean }> = [];

  class FakeRecognition {
    started = false;
    start() {
      this.started = true;
    }
    stop() {}
    abort() {}
    constructor() {
      recognitions.push(this);
    }
  }
  class FakeAudioContext {
    createAnalyser() {
      return { fftSize: 0, getFloatTimeDomainData() {} };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    close() {
      return Promise.resolve();
    }
  }
  Object.defineProperty(globalThis, "window", {
    value: {
      SpeechRecognition: FakeRecognition,
      setInterval: () => 0,
      clearInterval() {},
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: {
      language: "en-US",
      mediaDevices: {
        getUserMedia: () => new Promise((resolve) => microphones.push(resolve)),
      },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    value: FakeAudioContext,
    configurable: true,
  });

  const starts: Array<() => void> = [];
  const box = (control: ReactNode) => {
    starts.push(
      (control as ReactElement<{ onToggle: () => void }>).props.onToggle,
    );
    return null;
  };
  renderToString(
    createElement(
      Fragment,
      null,
      createElement(Dictated, {
        value: "",
        onValueChange: () => {},
        children: box,
      }),
      createElement(Dictated, {
        value: "",
        onValueChange: () => {},
        children: box,
      }),
    ),
  );

  starts[0]!();
  starts[1]!();
  microphones[0]!({
    getTracks: () => [{ stop: () => (firstMicrophoneStops += 1) }],
  } as unknown as MediaStream);
  microphones[1]!({ getTracks: () => [] } as unknown as MediaStream);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(firstMicrophoneStops).toBe(1);
  expect(
    recognitions.filter((recognition) => recognition.started),
  ).toHaveLength(1);
});
