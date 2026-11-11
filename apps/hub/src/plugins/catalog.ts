import { type, type Type } from "arktype";
import {
  Builder,
  checkInput,
  guidanceText,
  type ProjectValues,
  type Screen,
} from "@corbits-builder/plugin";
import pickFonts from "@corbits-builder/pick-fonts";
import fonts from "@corbits-builder/pick-fonts/data";
import { Fonts } from "@corbits-builder/pick-fonts/schema";
import pickColours from "@corbits-builder/pick-colours";
// Relative imports, because the plugins' exports do not include their package.json.
import pickFontsManifest from "../../../../plugins/pick-fonts/package.json";
import pickColoursManifest from "../../../../plugins/pick-colours/package.json";
import { unregisteredValue } from "../artifacts/project-values.ts";

const Manifest = type({ "description?": "string", builder: Builder }).narrow(
  ({ builder }, ctx) => {
    const unknown = unregisteredValue([
      ...(builder.reads ?? []),
      ...(builder.writes ?? []),
    ]);
    return (
      unknown === undefined ||
      ctx.mustBe(`naming only registered project values, not ${unknown}`)
    );
  },
);

export type Plugin = {
  builder: Builder;
  description: string;
  // What the coordinator reads to use it.
  guidance: string;
  // For a screen plugin: why this input cannot be shown, or undefined when it can.
  refusal?: (input: unknown, project: ProjectValues) => string | undefined;
};

export function plugin(manifest: unknown): Plugin {
  const { builder, description = "" } = Manifest.assert(manifest);
  return {
    builder,
    description,
    guidance: [
      `${builder.handle}: ${description}`,
      `Use it when: ${builder.when}`,
      `Not when: ${builder.unless}`,
    ].join("\n"),
  };
}

export function screenPlugin<In, Out, Data, Prepared>(
  manifest: unknown,
  screen: Screen<In, Out, Data, Prepared>,
  data: Type<Data>["infer"],
): Plugin {
  const { builder } = Manifest.assert(manifest);
  return {
    builder,
    description: screen.describe.summary,
    guidance: guidanceText(builder.handle, screen, builder.reads ?? []),
    refusal(input, project) {
      const checked = checkInput(builder.handle, screen, input, data, project);
      return checked.ok ? undefined : checked.text;
    },
  };
}

// The installed plugins, each checked once when the hub loads.
export const PLUGINS: readonly Plugin[] = [
  screenPlugin(pickFontsManifest, pickFonts, Fonts.assert(fonts)),
  screenPlugin(pickColoursManifest, pickColours, undefined),
];
