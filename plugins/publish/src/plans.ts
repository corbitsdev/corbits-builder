import type { ReadyPlanOffer } from "@corbits-builder/plugin";
import {
  recordedFor,
  type PublishTakeDown,
} from "@corbits-builder/plugin/publish";

/** What the host supplies the publish screens. */
export type Host = {
  readyPlans: (group: string) => readonly ReadyPlanOffer[];
};

/**
 * Whether publishing by the offered plan updates the recorded release. It does only when a plugin
 * in that plan's steps made the release and the next publish there can update it. A release from
 * anywhere else, or one its target cannot update yet, stays up at its own address. A plan that is
 * not offered replaces nothing.
 */
export const replacesRelease = (
  release: { target: string; updatable: boolean } | null,
  offered: ReadyPlanOffer | undefined,
): boolean =>
  release !== null &&
  release.updatable &&
  offered?.plugins.includes(release.target) === true;

/** What a take-down by the offered plan would remove, as the person is shown it. */
export type TakenDown = {
  /** The go-ahead the person gives for exactly what they are shown. */
  agreed: PublishTakeDown;
  /** The address people open the app at, when it is published there. */
  url: string | undefined;
  /** Where something that costs money is held, and what it costs, when there is one. */
  held: { place: string; costs: string | undefined } | undefined;
};

/**
 * What taking down by the offered plan removes: the release and the holding whose target is the
 * plugin its takeDown names. Null when the plan takes nothing down or that plugin recorded neither.
 */
export function takenDown(
  offered: ReadyPlanOffer | undefined,
  release: { target: string; url: string; at: string } | null,
  holding: {
    target: string;
    place: string;
    since: string;
    costs?: string | undefined;
  } | null,
): TakenDown | null {
  const target = offered?.takeDown?.plugin;
  if (target === undefined) return null;
  const recorded = recordedFor(target, release, holding);
  if (recorded.release === undefined && recorded.holding === undefined)
    return null;
  return {
    agreed: { target, ...recorded },
    url: recorded.release === undefined ? undefined : release?.url,
    held:
      recorded.holding === undefined || holding === null
        ? undefined
        : { place: holding.place, costs: holding.costs },
  };
}
