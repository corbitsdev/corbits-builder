# Building on the web-app starter

For a project started from the web-app starter, with `client/`, `server/` and `packages/shared` at its root. Any other project ignores this pack.

## The design

When a design is chosen it is in `.builder`, read-only: `.builder/DESIGN.md` and the mockup in `.builder/designs` set the look, screens, states and flows the app matches. Read `.builder/DESIGN.md` before writing code. The design's tokens head `DESIGN.md` as front matter; `.builder/designs/styles.css` holds their exact CSS in its `:root` and `.dark` blocks, which go into the client's global CSS after the `@corbits/react-ui` theme import. With no design chosen, use the starter's `@corbits/react-ui` theme for the look. The react-ui skill holds the props of every `@corbits/react-ui` component, grouped by kind, and the stack-docs skill says where each tool's docs start.

When the design and the build plan disagree, follow the design for how it looks and the plan for how it is built.

## The order of the work

Start by choosing how much of the starter the app needs: an app with no server work (no accounts, shared data or secrets) keeps the mockup's HTML and CSS as its client, split into pages where that helps, and leaves `server/` as the starter has it; an app that needs a server builds on the full starter. Say which you chose, and why, in your reply.

Scaffold the interface first. Build every screen from the design as a route with its layout, components and sample data before wiring anything to the server, so the person sees their app taking shape early. Match `.builder/designs/` screen by screen: the mockup's layout, copy and `data-testid` values are the spec. After each screen, try it in the running app with the browser tools at desktop and phone width. Once every screen renders and navigates, wire them to the real API one page at a time, replacing the sample-data queries with `getJson` calls. The wiring phase ends by deleting `client/src/sample-data.tsx`.

The starter's `CHECKS.txt` runs `check-app`, which takes up to two minutes, so run `check-stack` with a run_shell timeout of 120000.

## The product standard

The app is a product. It has one app shell: a left sidebar or a top bar for navigation, reachable at every width (a drawer from the top bar on a phone). Each screen has a clear hierarchy: one title, one primary action, then its content, built from `@corbits/react-ui` components on the theme's spacing, type and colour tokens, and everything fits its container. Empty, loading and error states are designed.

Every must in the requirements is on screen with real data, real units and sensible formatting (locale dates, rounded numbers, relative times such as "updated 2 min ago"). Where the requirements name an information item, it is visible without digging. Names beat identifiers: show the city, not coordinates. Say where data comes from and when it was last updated.
