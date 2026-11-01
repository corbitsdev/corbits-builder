# Slide deck

`@corbits/slidedeck`: writes a slide deck as a standard `.pptx` file that opens
in PowerPoint, Keynote, Google Slides and LibreOffice Impress. An agent
describes the deck as data matching the `Deck` schema, and
`writePptx(deck, assets)` returns the file's bytes.

```ts
import { assetKey, writePptx } from "@corbits/slidedeck";

const logo = { path: "brand/logo.png" };
const bytes = await writePptx(
  {
    theme: {
      colors: {
        primary: "#6D28D9",
        secondary: "#0EA5E9",
        accent: "#F59E0B",
        background: "#FFFFFF",
        text: "#1B1B1F",
        muted: "#6B7280",
      },
      fonts: { heading: "Georgia", body: "Inter" },
      logo,
    },
    slides: [{ layout: "title", title: "Builder overview" }],
  },
  new Map([[assetKey(logo), logoPngBytes]]),
);
```

## Where it fits

A pure library: it imports arktype and [`packages/zip`][zip], and nothing
from Builder or Interchange. Images arrive as bytes in `assets`, keyed by
`assetKey(ref)`; the writer never fetches them.

## API

- `Deck`, `Slide`, `Theme`, `Block`, `TextBlock`, `Paragraph`, `Element`,
  `ImageElement`, `AssetRef`: the arktype schemas, each also its type.
  `DeckInput` is the shape before defaults such as `fit: "contain"`.
- `validateDeck(input)`: `{ ok: true, deck }` or `{ ok: false, issues }`;
  each `DeckIssue` names its path and, inside a slide, the slide's index.
- `writePptx(deck, assets?)`: the `.pptx` bytes. Throws `DeckError`, which
  carries `issues`, for an invalid deck or a missing or unreadable image.
- `assetKey(ref)`: the `Assets` key for an `AssetRef`.

## Limits

- Seven layouts on a 16:9 slide: `title`, `section`, `content`,
  `two-column`, `comparison`, `image` and `blank`.
- Blocks are plain paragraphs and images; no lists, rich text, tables,
  charts or shapes. A region's blocks stack in equal-height bands.
- Images must be PNG or JPEG. Text is not measured; overflow is left to
  PowerPoint's autofit.
- A deck written twice gives the same bytes under one deflate
  implementation.

## Layout

- `src/deck.ts`: the deck model and its validation.
- `src/layouts.ts`: the slide size, safe areas and the seven layouts with
  their placeholders, plus the slide master.
- `src/theme.ts`: the theme from the deck's colour and font tokens.
- `src/write.ts`: slides, notes, media and the package parts.

## Working on it

`bun run test` writes the fixture in `test/fixture.ts`, which uses every
feature, and reads it back; extend the fixture when you add one.

[zip]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/zip
