# Designer

The product designer: designs an interface, such as a web app, a mobile
app's screens, a dashboard or a marketing page, as a clickable HTML and CSS
mockup with a `DESIGN.md` for whoever builds it, and files it as one design
option for the person to compare. It works from its instruction, from the
project's documents when there are any, or from a description of something
that exists. Its screens let the person say how many looks to compare, review
a mockup, choose between designs and pick fonts and colours.

## Where it fits

This folder is the whole designer plugin. Its `package.json` `builder` block
names its actions (the `mockup` workflow and the `looks`, `review`, `choose`,
`pick-fonts` and `pick-colours` screens), its design workspace (`design`: the
starter, the themes and the looks the coordinator draws concepts from), the
project values for its fonts and colours, the agent the hub builds and
installs from its prompt, workspace and role (`agents`), and the starter that starts its runs
(`starters`). The [coordinator][coordinator] starts it with `execute`, one designer
per design concept and pass.
Its tools are `read_file`, `write_file`, `edit_file` and `grep` in its
workspace, `check_design` and `report_blocked`; it has no shell. The hub reads
this plugin's starter and themes through its manifest.

## Layout

- `src/mockup/definition.ts`: the `mockup` action's input and how the
  coordinator fills it: its summary, when to use it and when not, and each
  field. The manifest keeps only what the folder cannot say, such as what the
  action reads and returns and which workflow it starts.
- `src/start.ts`: the starter. It refuses a call that has no theme for a
  concept (one of the looks, the person's brand saved, or `createTheme`) or no
  guidance (filed requirements, an app, or `audience` and `screens`), refuses a
  concept whose designer is still at work, starts one designer for each of the
  others, and writes each run's assignment from whatever documents are filed,
  the concept and the instruction.
- `src/default-looks.ts`: the looks as the coordinator reads them in the
  mockup's guidance and as the designer's Looks skill gives them, both from
  `design.looks`.
- `skills/create-theme/SKILL.md`: the Create a theme skill. Both skills are
  appended to the designer's system prompt in `src/prompt.ts`.
- `src/contract.ts`: the documents a designer can read and its assignment text.
- `src/prompt.ts`: the system prompt, as its default export, which the manifest
  names as the agent's prompt. The hub builds the agent from it and the role:
  a designer works in a design workspace on a posix sidecar, and its reply
  waits until the design is checked and filed. A later pass on the concept is
  a new run that starts from the draft this one left.
- `src/looks/`, `src/review/`, `src/choose/`, `src/pick-fonts/`,
  `src/pick-colours/`: the screens, each a `definition.ts`, which validates the
  input and prepares what the screen's `view.tsx` draws; an action with a view
  is a screen. `src/pick-fonts/data.json` is the font list it offers.
- `starter/`: the workspace every design begins from: `.builder/DESIGN.md`,
  `.builder/designs/index.html`, `.builder/designs/screens/home.html` and
  `.builder/designs/styles.css`, and a `README.md` for the designer that is not filed with the
  design.
- `themes/`: the three design themes (`modern-sleek`, `retro`,
  `liquid-glass`), each a sample `DESIGN.md` and `designs/` bundle: its
  stylesheet, which seeds the workspace, and a sample app to preview it.
- `src/skills.ts`: Bun macros that inline the starter, themes and skills
  where the plugin's own code reads them.

## Working on it

The design contract the coder relies on is the starter's `DESIGN.md` and
token names; change them together with the [coder][coder]. `bun run typecheck`
and `bun run test` cover it, and `bun run dev` runs it in a real project.

[coordinator]: https://github.com/corbitsdev/corbits-builder/tree/main/workflows/coordinator
[coder]: https://github.com/corbitsdev/corbits-builder/tree/main/plugins/coder
