/**
 * Where a plugin's screen sits in the room, validated and derived once for both the hub's loader
 * and the web interface.
 */
import type { Type } from "arktype";
import {
  ENTRY_PLACES,
  ScreenPlace,
  type EntryPlace,
} from "@corbits-builder/schemas/project";
import type { Screen, ScreenEntry, ScreenPlaces } from "./index.ts";

/** One entry place that shows where a screen stands and opens it in the main pane. */
export type PlacedEntry<Prepared> = {
  place: EntryPlace;
  status: ScreenEntry<Prepared>["status"];
};

/** What a screen puts in the prompt box, when it fills it. */
export type PromptBoxPlacement<In, Out, Prepared, Resources> = NonNullable<
  ScreenPlaces<In, Out, Prepared, Resources>["prompt-box"]
>;

/**
 * Where a screen is drawn in the room: whether it fills the main pane, what it puts in the prompt
 * box (if anything), and the entry places that open it.
 */
export type ScreenPlacement<In, Out, Prepared, Resources> = {
  mainPane: boolean;
  promptBox: PromptBoxPlacement<In, Out, Prepared, Resources> | null;
  entries: readonly PlacedEntry<Prepared>[];
};

/** The places a screen declares, or a card in the prompt box by default. */
export const placesOf = <In, Out, Data, Prepared, Resources>(
  screen: Screen<In, Out, Data, Prepared, Resources>,
): ScreenPlaces<Type<In>["infer"], Type<Out>["infer"], Prepared, Resources> =>
  screen.places ?? { "prompt-box": { size: "md" } };

/** Where a valid screen is drawn in the room, derived once from its declared places. */
export function screenPlacement<In, Out, Data, Prepared, Resources>(
  screen: Screen<In, Out, Data, Prepared, Resources>,
): ScreenPlacement<Type<In>["infer"], Type<Out>["infer"], Prepared, Resources> {
  const places = placesOf(screen);
  return {
    mainPane: places["main-pane"] !== undefined,
    promptBox: places["prompt-box"] ?? null,
    entries: ENTRY_PLACES.flatMap((place) => {
      const status = places[place]?.status;
      return status === undefined ? [] : [{ place, status }];
    }),
  };
}

/**
 * Validates where a screen places itself and returns its normalized placement; throws for any
 * placing the room cannot draw or any field from the contract before places.
 */
export function placeScreen<In, Out, Data, Prepared, Resources>(
  name: string,
  screen: Screen<In, Out, Data, Prepared, Resources>,
): ScreenPlacement<Type<In>["infer"], Type<Out>["infer"], Prepared, Resources> {
  // Each part of the contract before places, which would otherwise install with nothing shown.
  for (const part of ["render", "status", "decision"])
    if (part in screen)
      throw new Error(`${name}'s definition ${part} now goes under places`);
  if (screen.describe.says !== undefined && "reply" in screen.describe.says)
    throw new Error(
      `${name}'s definition says.reply is now the prompt-box's reply under places`,
    );
  const places = placesOf(screen);
  const stray = Object.keys(places).find((place) => !ScreenPlace.allows(place));
  if (stray !== undefined)
    throw new Error(
      `${name}'s definition places ${stray}, which is not a place in the room`,
    );
  if (Object.keys(places).length === 0)
    throw new Error(
      `${name}'s definition places the screen nowhere; leave places out for a card in the prompt box`,
    );
  const box = places["prompt-box"];
  if (box === undefined && screen.state === undefined)
    throw new Error(
      `${name}'s definition asks a question, which waits in the prompt box, but places none there`,
    );
  if (box?.size === "sm" && places["main-pane"] === undefined)
    throw new Error(
      `${name}'s definition draws only a decision in the prompt box, so its view needs a main-pane`,
    );
  if (box?.size === "sm" && screen.state !== undefined)
    throw new Error(
      `${name}'s definition prompt-box size sm draws a question's decision, which a screen with a state never asks`,
    );
  if (box !== undefined && box.size !== "sm" && box.size !== "md")
    throw new Error(`${name}'s definition prompt-box size must be sm or md`);
  if (box?.size === "md" && places["main-pane"] !== undefined)
    throw new Error(
      `${name}'s definition draws its view in the main pane and as a card in the prompt box`,
    );
  if (box?.decision !== undefined && typeof box.decision.offer !== "function")
    throw new Error(`${name}'s definition decision offer must be a function`);
  const entries = ENTRY_PLACES.flatMap((place) => {
    const status = places[place]?.status;
    if (status === undefined) return [];
    if (screen.state === undefined || places["main-pane"] === undefined)
      throw new Error(
        `${name}'s definition ${place} opens a screen shown on its own, so it needs a state and a main-pane`,
      );
    return [{ place, status }];
  });
  return {
    mainPane: places["main-pane"] !== undefined,
    promptBox: box ?? null,
    entries,
  };
}
