/** The plugin screens this interface can draw, by plugin handle. First-party plugins are compiled in. */
import type { ComponentType } from "react";
import { Builder } from "@corbits-builder/plugin";
import pickFonts from "@corbits-builder/pick-fonts";
import fonts from "@corbits-builder/pick-fonts/data";
import { Fonts } from "@corbits-builder/pick-fonts/schema";
import { FontPicker } from "@corbits-builder/pick-fonts/view";
import pickColours from "@corbits-builder/pick-colours";
import { ColourPicker } from "@corbits-builder/pick-colours/view";
import reviewMockup from "@corbits-builder/review-mockup";
import { MockupReview } from "@corbits-builder/review-mockup/view";
// Relative imports, because the plugins' exports do not include their package.json.
import pickFontsManifest from "../../../../../plugins/pick-fonts/package.json";
import pickColoursManifest from "../../../../../plugins/pick-colours/package.json";
import reviewMockupManifest from "../../../../../plugins/review-mockup/package.json";
import { screenHost, type ScreenHostProps } from "./screen-question.tsx";

const manifests = {
  pickFonts: Builder.assert(pickFontsManifest.builder),
  pickColours: Builder.assert(pickColoursManifest.builder),
  reviewMockup: Builder.assert(reviewMockupManifest.builder),
};

/** The screens drawn over the whole room rather than in the conversation. */
export const pageScreens: ReadonlySet<string> = new Set(
  Object.values(manifests)
    .filter((builder) => builder.place === "page")
    .map((builder) => builder.handle),
);

export const screens: Record<string, ComponentType<ScreenHostProps>> = {
  "pick-fonts": screenHost(manifests.pickFonts, {
    screen: pickFonts,
    view: FontPicker,
    data: Fonts.assert(fonts),
    writes: {
      "look.font-primary": (output) => output.primary.name,
      "look.font-secondary": (output) => output.secondary.name,
    },
  }),
  "pick-colours": screenHost(manifests.pickColours, {
    screen: pickColours,
    view: ColourPicker,
    data: undefined,
    writes: {
      "look.color-primary": (output) => output.primary,
      "look.color-background": (output) => output.background,
    },
  }),
  "review-mockup": screenHost(manifests.reviewMockup, {
    screen: reviewMockup,
    view: MockupReview,
    data: undefined,
    writes: {},
  }),
};
