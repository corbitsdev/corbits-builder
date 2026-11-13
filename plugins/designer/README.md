# Designer

The product designer: designs an interface, such as a web app, a mobile
app's screens, a dashboard or a marketing page, as a clickable HTML and CSS
mockup with a `DESIGN.md` for whoever builds it, and files it as one design
option for the person to compare. It works from its instruction, from the
project's documents when there are any, or from a description of something
that exists. Its screens let the person choose a design and pick its fonts
and colours.

## Where it fits

This folder is the whole designer plugin. Its `package.json` `builder` block
names its actions (the `mockup` workflow and the `review`, `choose`,
`pick-fonts` and `pick-colours` screens), the workflow package the hub builds
and installs from it (`packages`), and the starter that starts its runs
(`starters`). The [coordinator][coordinator] starts it with `execute`, one designer
per design concept and pass.
Its tools are file reads and writes in its workspace, `check_design`,
`file_design_option` and `mail`; it has no shell. The hub also reads this
package's starter, themes and skills through its macros.

## Layout

- `src/mockup/definition.ts`: the `mockup` action's input and how the
  coordinator fills it: its summary, when to use it and when not, and each
  field. The manifest keeps only what the folder cannot say, such as what the
  action reads and returns and which workflow it starts.
- `src/start.ts`: the starter. It refuses a concept whose designer is still at
  work, starts one designer for each of the others, and writes each run's
  assignment from whatever documents are filed, the concept and the
  instruction.
- `src/contract.ts`: the documents a designer can read and its assignment text.
- `src/packages/designer.ts`: the installed package, which assembles the agent
  from the hub's model, director and tools, and asks the director to hold a
  reply until the design is checked and filed.
- `src/prompt.ts`: the system prompt.
- `src/agent.ts`: `createDesignerAgent`, which requires an explicit provider
  and model.
- `src/workflow.ts`: `createDesignerWorkflow`, a mail-triggered step on a
  posix sidecar that takes one design pass and ends. A later pass on the
  concept is a new run that starts from the draft this one left.
- `src/looks/`, `src/review/`, `src/choose/`, `src/pick-fonts/`,
  `src/pick-colours/`: the screens, each a `definition.ts`, which validates the
  input and prepares what the screen's `view.tsx` draws; an action with a view
  is a screen. `src/pick-fonts/data.json` is the font list it offers.
- `starter/`: the workspace every design begins from: `.builder/DESIGN.md`,
  `.builder/designs/index.html`, `.builder/designs/screens/home.html` and
  `styles.css`, and a `README.md` for the designer that is not filed with the
  design.
- `themes/`: the design themes a person can preview and pick, each a sample
  `DESIGN.md` and `designs/` bundle.
- `src/skills.ts`: Bun macros that inline the starter and themes when the
  hub is bundled.

## Working on it

The design contract the coder relies on is the starter's `DESIGN.md` and
token names; change them together with the [coder][coder]. `bun run typecheck`
and `bun run test` cover it, and `bun run dev` runs it in a real project.

[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
[coder]: https://github.com/corbitsdev/corbits-builder/tree/main/plugins/coder
