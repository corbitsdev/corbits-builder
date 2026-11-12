# Coordinator moves baseline

What does Builder's coordinator do first when a person makes one remark about
an app it has already built? This harness measures that on real models, so a
change to the coordinator's prompt, its tools or the hub's plugin hint can be
compared against a baseline instead of a hunch.

For each case it imports the same built weather app as a fresh project, sends
one remark as the person and watches the coordinator until it has made two
moves, parked a question, is waiting on an approval, has ended its turn in
text, or the case deadline passes. It never answers the question or decides
the approval. It then archives the project and waits until none of that case's
runs is still running before the next case starts.

Each case is one remark, one model, one hint setting (`PLUGIN_HINT`: off,
triggers or fields) and one repeat. The matrix is data in
[`cases.json`](cases.json): each remark lists the acceptable first moves and
the unacceptable ones, using these move names:

- `discover`: looked for a capability with the `discover` tool.
- `open:designer.pick-fonts`, `open:designer.pick-colours`: opened that screen for the person.
- `ask`: asked the person a plain question, with the `question` tool or in a
  closing reply that holds a question mark.
- `execute:<plugin>.<action>`: started that plugin action with `execute`,
  such as `execute:coder.change` to have a coder change the app, and
  `execute:<plugin>` for a route. Classic's `instruct_coder` (which waits for
  approval) counts as `execute:coder.change`.
- `read`: read the project's documents or design with `read_artifact`.
- `reply`: a closing reply that neither asks nor acts.

Any other tool shows up as `tool:<name>`. A run of moves is acceptable when an
`acceptable` list begins it, or begins what follows its leading reads, unacceptable when it holds an `anywhere` move or
starts with a `first` move, and `other` otherwise. A refused screen call
followed by the same screen counts as one attempt. The verdict is recorded,
never asserted.

`recorder.ts` turns one case into one record: the remark, model, hint,
mode and repeat; the project's preferences and frozen models as the hub reports them;
whether the hub's plugin note reached the coordinator and which plugins it
named; the ordered moves with their tool and arguments; for a screen, whether
the first call was valid and, if refused, whether the next one was; whether it
read project material before acting or asking; the coordinator's replies; the
verdict; why the case stopped; and timings.

## Running it

It needs the e2e Postgres from [docs/DEV.md](../../docs/DEV.md#tests) and an
environment file naming it. Neither `bun run test` nor `bun run test:e2e`
picks this folder up; it runs only when named.

The scripted proof runs every case on the scripted model, which acts out a
known move per case, and asserts the recorder saw exactly that move and the
right plugin note for each hint setting. Run it before any paid run:

```sh
bun --env-file=<env file> --conditions=intx-src test test/baseline/coordinator-moves.test.ts --timeout 0
```

A first small real run, Terra only, hint off, each remark once:

```sh
OPENAI_API_KEY=<key> BASELINE_MODELS=terra BASELINE_HINTS=off BASELINE_REPEATS=1 \
  bun --env-file=<env file> --conditions=intx-src test test/baseline/coordinator-moves.test.ts --timeout 0
```

A real run spends money on the provider's account. The full default matrix
for both real models is 6 remarks x 3 hints x 2 repeats x 2 models = 72
cases. Each case is the coordinator's import acknowledgement plus up to about
three turns after the remark, so roughly 4 model turns a case and about 300
coordinator turns for the full matrix, each at the coordinator tier
(`gpt-6.1-terra` at high effort, `claude-sonnet-5-5` at medium). The weather
app itself is always built on the scripted model, which costs nothing.

## Settings

- `BASELINE_MODELS`: comma-separated model ids from `cases.json` (`terra`,
  `sonnet`, `scripted`). Default `scripted`. A real model runs only when it is
  listed and its key (`OPENAI_API_KEY` for Terra, `ANTHROPIC_API_KEY` for
  Sonnet) is set; the key goes to the test hub alone.
- `BASELINE_HINTS`: comma-separated hint settings. Default all three.
- `BASELINE_MODE`: the coordinator mode the case hubs run, `classic` or
  `dynamic` (the hub's `COORDINATOR_MODE`). Default `classic`. The weather
  app is always built on `classic`, which its recorded fixture follows. Each
  record names it as `mode`.
- `BASELINE_REMARK`: run only remarks containing this text.
- `BASELINE_REPEATS`: repeats per remark. Default from `cases.json` (2).
- `BASELINE_MAX_CASES`: stop after this many cases.
- `BASELINE_CASE_DEADLINE_MS`: how long to wait for the acknowledgement, and
  again for the coordinator's moves. Default 180000.
- `BASELINE_RESULTS`: the results file. Default a new
  `coordinator-moves-<time>.jsonl` in the session scratchpad's `baseline/`
  folder.

Results are one JSON line per case, written as each case finishes, and a table
at the end with a row per remark and a column per model and hint, each cell
the first move and verdict of each repeat.
