import { type } from "arktype";

export const lists = {
  all: "Every font. Use when the person has no preference.",
  sans: "Clean and modern. Good for apps and dashboards.",
  serif: "Classic and bookish. Good for long reading and editorial pages.",
  display: "Loud and characterful. Good for headings and logos, not body text.",
  mono: "Every letter the same width. Good for code and figures.",
};

export const Font = type({
  "+": "reject",
  name: "string > 0",
  lists: type("'sans' | 'serif' | 'display' | 'mono'").array().atLeastLength(1),
  license: "'free' | 'paid'",
  "needs?": "'adobe_fonts_connected'",
});
export type Font = typeof Font.infer;

export const Fonts = Font.array().atLeastLength(1);

export const Input = type({
  "+": "reject",
  "proposed?": {
    "+": "reject",
    "primary?": "string > 0",
    "secondary?": "string > 0",
  },
  list: type("string")
    .or(type("string > 0").array().atLeastLength(1).atMostLength(20))
    .default("all"),
});

export const Output = type({
  "+": "reject",
  primary: Font,
  secondary: Font,
});
