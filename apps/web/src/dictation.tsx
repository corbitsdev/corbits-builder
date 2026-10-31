/**
 * Dictation: speaking into a composer instead of typing into it.
 *
 * The browser's own speech recognition, with the microphone read alongside it
 * for the level. Where either is missing the control is absent.
 *
 * Words land in the composer as they are recognised, appended to whatever
 * was typed. The microphone goes green while it is open and a waveform
 * follows the input, because a live microphone must never be ambiguous. A
 * tap on the microphone ends it, and so does a short silence once something
 * has been said.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DictationStatusLine,
  MicButton,
  type DictationState,
} from "@corbits/react-ui";

/** How many recent levels the waveform shows. */
const WAVE_BARS = 24;
/** Silence after speech that ends a session. */
const SILENCE_AFTER_SPEECH_MS = 1500;
const SOUND_FLOOR = 0.015;

/** Why it stopped, in words a person can act on. Anything else is shown as is. */
const REFUSALS: Record<string, string> = {
  "not-allowed":
    "Dictation was not allowed. Microphone and speech recognition permission are needed.",
  "service-not-allowed": "Speech recognition is not available on this system.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition could not reach its service.",
};
/** Ends that are not failures. */
const QUIET_ENDS = new Set(["stopped", "silence", "final"]);

/**
 * The one session open anywhere on the page. A page has a microphone beside
 * every text box, and a person who taps a second one means to speak into
 * that box; the first is ended rather than left listening beside it.
 */
let openSession: { abort: () => void } | null = null;

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
};
function browserRecognizer(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** A running session: one way to stop it. */
type Session = { stop: () => void; abort: () => void };

function useDictation(value: string, onValueChange: (value: string) => void) {
  const [listening, setListening] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(() =>
    Array(WAVE_BARS).fill(0),
  );
  // Sound has reached the page. Before that the microphone is being asked
  // for, which can take as long as a permission dialog takes.
  const [live, setLive] = useState(false);
  const session = useRef<Session | null>(null);
  const current = useRef(value);
  current.current = value;
  const change = useRef(onValueChange);
  change.current = onValueChange;

  // Only where the microphone can be read beside the speech API, since
  // without a level there is no waveform and no silence rule.
  const supported =
    browserRecognizer() !== null &&
    typeof navigator.mediaDevices?.getUserMedia === "function";

  const pushLevel = useCallback((level: number) => {
    setLive(true);
    setLevels((history) => [
      ...history.slice(1),
      Math.max(0, Math.min(1, level)),
    ]);
  }, []);

  const finish = useCallback((reason: string) => {
    if (openSession !== null && openSession === session.current)
      openSession = null;
    session.current = null;
    setListening(false);
    setLive(false);
    setLevels(Array(WAVE_BARS).fill(0));
    if (!QUIET_ENDS.has(reason)) setRefusal(reason);
  }, []);

  const start = useCallback(async () => {
    if (session.current) return;
    if (openSession) {
      openSession.abort();
      openSession = null;
    }
    const typed = current.current.trimEnd();
    const base = typed.length > 0 ? `${typed} ` : "";
    setRefusal(null);
    setListening(true);

    const Recognizer = browserRecognizer();
    if (!Recognizer) {
      finish("Speech recognition is not available in this browser.");
      return;
    }
    const recognition = new Recognizer();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    let heardSpeech = false;
    let lastSound = performance.now();
    let ended: string | null = null;
    let stoppedByUs = false;

    // The level, read from the microphone beside the recognizer. A refused
    // microphone still dictates; it just has no waveform to show.
    let meter: {
      stream: MediaStream;
      context: AudioContext;
      timer: number;
    } | null = null;
    const closeMeter = () => {
      if (!meter) return;
      clearInterval(meter.timer);
      meter.stream.getTracks().forEach((track) => track.stop());
      void meter.context.close();
      meter = null;
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        pushLevel(rms * 6);
        if (rms > SOUND_FLOOR) lastSound = performance.now();
        else if (
          heardSpeech &&
          performance.now() - lastSound > SILENCE_AFTER_SPEECH_MS
        ) {
          stoppedByUs = true;
          recognition.stop();
        }
      }, 50);
      meter = { stream, context, timer };
    } catch {
      meter = null;
    }

    recognition.onresult = (event) => {
      const heard: string[] = [];
      for (let at = 0; at < event.results.length; at++) {
        const text = event.results[at]?.[0]?.transcript.trim();
        if (text) heard.push(text);
      }
      if (heard.length > 0) {
        heardSpeech = true;
        lastSound = performance.now();
      }
      change.current(base + heard.join(" "));
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      ended =
        REFUSALS[event.error] ??
        `Dictation stopped unexpectedly (${event.error}${event.message ? `: ${event.message}` : ""}). Try again.`;
    };
    recognition.onend = () => {
      closeMeter();
      finish(
        ended ??
          (heardSpeech || stoppedByUs
            ? "final"
            : "Dictation ended before anything was heard."),
      );
    };
    session.current = {
      stop: () => {
        stoppedByUs = true;
        recognition.stop();
      },
      abort: () => {
        closeMeter();
        recognition.abort();
      },
    };
    openSession = session.current;
    try {
      recognition.start();
    } catch (cause) {
      closeMeter();
      finish(String(cause));
    }
  }, [finish, pushLevel]);

  const stop = useCallback(() => session.current?.stop(), []);

  // Leaving the screen mid-sentence must not leave the microphone open.
  useEffect(() => () => session.current?.abort(), []);

  return { supported, listening, live, levels, refusal, start, stop };
}

/**
 * A text box with a microphone beside it, on the left. Where there is no
 * way to dictate the box is rendered alone: a control that does not exist
 * is absent.
 *
 * The microphone sits level with a composer's send button (`end`), at the
 * top of a plain text area (`start`), or centered on a one-line field
 * (`center`). A PromptInput host passes a function child and places the
 * returned control in its toolbar, so the mic lives in the footer
 * instead of overlaying it. While listening the button is green and a
 * line under the box says "Listening:" with a waveform of the input
 * beside it. A refusal takes the same line. Otherwise the line is
 * absent, so the row never changes shape.
 */
export function Dictated({
  value,
  onValueChange,
  disabled = false,
  align = "end",
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** The box is busy; dictation into it would be lost. */
  disabled?: boolean;
  /** Where the microphone sits against the box. Ignored when `children` is a function. */
  align?: "end" | "start" | "center";
  children: ReactNode | ((control: ReactNode) => ReactNode);
}) {
  const { supported, listening, live, levels, refusal, start, stop } =
    useDictation(value, onValueChange);
  useEffect(() => {
    if (disabled && listening) stop();
  }, [disabled, listening, stop]);
  const slotted = typeof children === "function";
  const state: DictationState = listening
    ? live
      ? "listening"
      : "starting"
    : "idle";
  const control = supported ? (
    <MicButton
      className="dictate"
      state={state}
      disabled={disabled}
      onToggle={listening ? stop : () => void start()}
    />
  ) : null;
  const field = slotted ? children(control) : children;
  if (!supported) return <>{field}</>;
  return (
    <div className="dictated">
      {slotted ? (
        field
      ) : (
        <div className={`dictated-row dictated-row-${align}`}>
          {control}
          {field}
        </div>
      )}
      <DictationStatusLine
        className="dictation-state"
        state={refusal ? "denied" : state}
        levels={levels}
        startingLabel="Starting the microphone… If macOS asks, allow it."
        {...(refusal ? { errorMessage: refusal } : {})}
      />
    </div>
  );
}
