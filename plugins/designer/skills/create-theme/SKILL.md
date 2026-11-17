## Skill: Create a theme

Use this when your concept has no ready theme: its look is none of the Looks above, or the person gave their own brand. A theme is a small set of decisions that every screen inherits, so make them once, on purpose, before you draw anything. A theme improvised screen by screen drifts, and the builder cannot map it. Work through these steps in order; each one leans on the one before.

### 1. Gather what the brand already says

Collect every input that exists before inventing anything, because the person's own brand outranks your taste:

- Brand guidelines: the brand.guidelines line of the Project values in your task, as text, a link or an attached file.
- Saved fonts and colours: look.font-primary, look.font-secondary, look.color-primary and look.color-background in the same block. A saved value is a decision the person already made; use it as given and build around it.
- A website or images the person pointed to, as the instruction or the guidelines describe them.
- The instruction, the person's ideas for the look in their words, and the concept's direction.

You cannot open links, websites or attached files from your workspace. Work from what the task says of them, and name in your hand-back anything you could not see, rather than guessing at it.

### 2. Name the personality, and what it must not be

Write three to five words for how the product should feel to the people who use it, such as "calm, exact, trustworthy", and one line for what it must never be, such as "never playful or loud". Take the words from the brand and the audience, not from a trend. Every later choice is checked against these words: a colour or a typeface that fights them is wrong however good it looks alone.

### 3. Build the colour system by role

Choose colours for what they do, not one by one. Each token below is a role the kit's components already use, and the builder maps the names one to one, so set every one of them and never rename them:

- Surfaces: `--background` for the page, `--card` and `--popover` for raised panels and menus, `--secondary` and `--muted` for quiet fills.
- Text: `--foreground` on the page, and the `-foreground` partner of each surface and colour (`--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--muted-foreground` for secondary text, and so on).
- Primary: `--primary` for the one main action and links, `--primary-foreground` for text on it, `--primary-active` for its pressed state, and `--ring` for keyboard focus, usually the primary or a clear partner of it.
- Accent: `--accent` and `--accent-foreground` for selection and highlights, a quiet tint of the primary or a second brand colour.
- States: `--destructive`, `--success` and `--warning`, each with its `-foreground`. Keep them recognisable as danger, success and caution whatever the brand colours are.
- Lines: `--border` for dividers and card edges, `--input` for field outlines.

Give most of the screen to neutrals and spend the brand colour on the primary action, so the eye goes where the person acts. The primary must be this brand's hue, never the kit's orange `#e98428`. Surfaces are solid colours: check_design fails any CSS gradient.

Then set the same roles again for dark mode. Dark is not an inversion: surfaces get lighter as they rise (page darkest, cards and popovers above it), and the primary usually gets lighter and a little less saturated so it does not glow.

Check contrast for every text and surface pair, in light and dark: at least 4.5 to 1 for body text and `--muted-foreground` on its surface, at least 3 to 1 for large text, `--border` and `--input` against the page, and the focus ring. Work out the ratios from the colours' relative luminance rather than by eye, and fix a pair that fails by moving its lightness, not by swapping its hue.

### 4. Choose and scale the type

Choose `--font-sans` for the voice of the product: a serif reads literary or established, a geometric sans modern, a humanist sans friendly, a monospace technical. The mockup works offline, so use fonts every device has, written as a stack with fallbacks, and never the kit's "Red Hat Display" stack, which check_design fails. A saved look.font-primary leads the stack. Set `--font-mono` for code and figures, with look.font-secondary leading it when saved. Add `--font-display` only when headings carry the personality and the body would tire in that face, and then add the rules that use it.

Pick a small scale and keep to it, as the built-in themes do: about six sizes with their line heights, such as 12/16, 13/18, 14/20, 16/24, 28/36 and 32/40, and two or three weights. Tight tracking on large headings and tabular figures in tables keep a dense screen calm.

### 5. Set spacing, corners, borders and depth

These carry as much personality as colour. Use a spacing scale on a 4px grid, such as 4, 8, 12, 16, 20, 24, 40 and 64px. Set `--radius` once, with `--radius-sm` and `--radius-lg` derived from it with calc(), as the themes do: 0 reads strict and serious, about 0.5rem neutral, 1rem and up soft and friendly. Decide whether edges are hairline borders, solid ink outlines or no line at all, and how raised things are: `--shadow-card` for cards and `--shadow-popover` for dialogs, menus and toasts. Keep motion short and quiet with `--ease-out`, `--ease-in-out`, `--duration-micro`, `--duration-standard` and `--duration-large`. Choose one signature, a single memorable detail such as a lead figure on a solid card or buttons that press into the page, and use it sparingly.

### 6. Prove it on real components

Before designing every screen, draw your first real screen with the parts the product will lean on: a primary and an outline button, a labelled input, a card with a figure, a table or list row, a badge in each state, and a dialog and a toast it opens. Run check_design and read its findings, and look again at contrast and spacing in light and dark. Fix the tokens now, while one screen depends on them, not after six.

### 7. Write it in the form the built-in themes take

In designs/styles.css, replace the top of the file in one edit, keeping every component rule below it:

- a first line `/* Tokens: names match @corbits/react-ui. <Look name>: <the idea in a few words>. */`;
- a `:root` block with every token above, plus `--radius-sm`, `--radius-lg`, `--shadow-card`, `--shadow-popover`, `--font-sans`, `--font-mono`, the motion tokens and `color-scheme: light`;
- a `.dark` block with every colour token and both shadows for dark, and `color-scheme: dark`;
- a `@media (prefers-color-scheme: dark)` block whose `:root:not(.dark):not(.light)` repeats the `.dark` block, so the mockup follows the person's system setting.

Keep both blocks within the first 90 lines. Add a token of your own, such as `--font-display`, only with the rules that use it.

In DESIGN.md, add a `## Direction` section after the Overview, in the bullets the themes use: the person's words for the look and feel, the idea in a sentence, the colour (the primary's hex and what it marks, and the neutrals), the type (the stacks and how headings and figures are set), the signature, and the icons. The tokens themselves are added from styles.css when the design is filed, so do not copy them in.

### 8. Check and hand back

Run check_design until it passes. In your hand-back, say in plain words what you decided and why: the personality words, the primary colour and what it is for, the type, and the corner and depth choices, and which of them came from the person's brand and which you chose. Name any brand input you could not see, so the person can correct the theme on the next pass.
