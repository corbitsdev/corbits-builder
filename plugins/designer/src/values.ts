import { type } from "arktype";
import { defineValue } from "@corbits-builder/plugin";

export const FONT_PRIMARY = defineValue(
  "look.font-primary",
  type(/^[A-Za-z0-9 -]{1,40}$/),
  "The font for headings and text.",
  { style: { token: "font-sans", leads: true } },
);

export const FONT_SECONDARY = defineValue(
  "look.font-secondary",
  type(/^[A-Za-z0-9 -]{1,40}$/),
  "The font for code and figures.",
  { style: { token: "font-mono", leads: true } },
);

export const COLOR_PRIMARY = defineValue(
  "look.color-primary",
  type(/^#[0-9a-fA-F]{6}$/),
  "The brand colour of buttons and links.",
  { style: { token: "primary" } },
);

export const COLOR_BACKGROUND = defineValue(
  "look.color-background",
  type(/^#[0-9a-fA-F]{6}$/),
  "The page colour behind everything.",
  { style: { token: "background" } },
);

export default [FONT_PRIMARY, FONT_SECONDARY, COLOR_PRIMARY, COLOR_BACKGROUND];
