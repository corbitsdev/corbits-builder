// A model's runaway turns repeat one passage back to back until the output cap: a 136 KB designer
// turn restated one "FINAL: ... — NO!!!" pair of lines for 114000 characters, a coder text repeated
// "Bramble: I'll append the shell classes." and another "br>br>br>". A stream is cut once its
// newest characters are at least REPEATS exact copies of one passage spanning MIN_SPAN characters.
// A designer drafting a mockup in its reasoning writes identical placeholder cards back to back:
// six 871-character recipe cards tripped an 800-character span. A runaway runs to the output cap,
// so a span past any drafted page still cuts it a tenth of the way in.
const REPEATS = 4;
const MIN_SPAN = 12000;
const RECENT = 16000;
const CHECK_EVERY = 32;
const PROBE = 16;

/** Prefix of the protocol_mismatch message the OpenAI-compatible adapter raises when it cuts a runaway stream. */
export const REPETITION_ABORT = "repetition_abort";

// The length of the run at the end of `text` that repeats with period `period`.
function periodicSpan(text: string, period: number): number {
  let at = text.length - 1;
  while (at - period >= 0 && text[at] === text[at - period]) at--;
  return text.length - 1 - at + period;
}

/** Returns a function that takes each streamed piece of one block and says whether it now repeats. */
export function repetitionWatch(): (piece: string) => boolean {
  let recent = "";
  let unchecked = 0;
  return (piece) => {
    recent = (recent + piece).slice(-RECENT);
    unchecked += piece.length;
    if (unchecked < CHECK_EVERY || recent.length < MIN_SPAN) return false;
    unchecked = 0;
    // Every earlier copy of the newest characters, nearest first, is a candidate period.
    const end = recent.length - PROBE;
    const probe = recent.slice(end);
    for (
      let at = recent.lastIndexOf(probe, end - 1);
      at !== -1 && (end - at) * REPEATS <= recent.length;
      at = recent.lastIndexOf(probe, at - 1)
    ) {
      const span = periodicSpan(recent, end - at);
      if (span >= MIN_SPAN && span >= (end - at) * REPEATS) return true;
    }
    return false;
  };
}
