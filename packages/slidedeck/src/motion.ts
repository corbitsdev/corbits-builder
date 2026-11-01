import type { Animation, Side, Transition } from "./deck.ts";
import type { Target } from "./free.ts";
import { escapeXml } from "./xml.ts";

const MC =
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const P14 =
  'xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"';
const P159 =
  'xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main"';

// The movement direction: content arriving from the right moves left; transitions take its initial.
const TOWARD: Record<Side, string> = {
  left: "right",
  right: "left",
  top: "down",
  bottom: "up",
};

function speed(duration: number) {
  if (duration <= 500) return "fast";
  if (duration <= 750) return "med";
  return "slow";
}

/** An exact duration needs PowerPoint 2010 and Morph needs 2019; older viewers take the fallback, with Morph as a fade. */
export function transitionXml(transition: Transition) {
  const effect =
    "from" in transition
      ? `<p:${transition.type} dir="${TOWARD[transition.from].charAt(0)}"/>`
      : "<p:fade/>";
  const [requires, chosen] =
    transition.type === "morph"
      ? [`${P14} ${P159} Requires="p159"`, '<p159:morph option="byObject"/>']
      : [`${P14} Requires="p14"`, effect];
  const spd = speed(transition.duration);
  return `<mc:AlternateContent ${MC}><mc:Choice ${requires}><p:transition spd="${spd}" p14:dur="${transition.duration}">${chosen}</p:transition></mc:Choice><mc:Fallback><p:transition spd="${spd}">${effect}</p:transition></mc:Fallback></mc:AlternateContent>`;
}

const PRESETS = {
  fade: 10,
  fly: 2,
  wipe: 22,
  zoom: 53,
  scale: 6,
  spin: 8,
  pulse: 26,
  path: 0,
} as const;

const ZOOM_FROM_CENTER = 16;
const SUBTYPES: Record<Side, number> = { top: 1, right: 2, bottom: 4, left: 8 };
const OFF_SLIDE: Record<Side, [string, string]> = {
  left: ["ppt_x", "0-#ppt_w/2"],
  right: ["ppt_x", "1+#ppt_w/2"],
  top: ["ppt_y", "0-#ppt_h/2"],
  bottom: ["ppt_y", "1+#ppt_h/2"],
};
const NODE_TYPES = {
  onClick: "clickEffect",
  withPrevious: "withEffect",
  afterPrevious: "afterEffect",
} as const;

type Behavior = {
  attributes?: string[];
  at?: number;
  additive?: boolean;
  autoReverse?: boolean;
};

class Timeline {
  #lastId = 0;
  readonly builds: { target: Target; grpId: number }[] = [];

  id() {
    return ++this.#lastId;
  }

  /** Each effect on a shape is its own build, numbered per shape. */
  grpId(target: Target) {
    const grpId = this.builds.filter(
      (build) => build.target.spid === target.spid,
    ).length;
    this.builds.push({ target, grpId });
    return grpId;
  }

  behavior(
    spid: number,
    duration: number,
    {
      attributes = [],
      at = 0,
      additive = false,
      autoReverse = false,
    }: Behavior = {},
  ) {
    const start =
      at > 0 ? `<p:stCondLst><p:cond delay="${at}"/></p:stCondLst>` : "";
    const names = attributes.length
      ? `<p:attrNameLst>${attributes.map((name) => `<p:attrName>${name}</p:attrName>`).join("")}</p:attrNameLst>`
      : "";
    const node = `<p:cTn id="${this.id()}" dur="${duration}"${autoReverse ? ' autoRev="1"' : ""} fill="hold"`;
    const timing = start ? `${node}>${start}</p:cTn>` : `${node}/>`;
    return `<p:cBhvr${additive ? ' additive="base"' : ""}>${timing}<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>${names}</p:cBhvr>`;
  }

  visibility(spid: number, value: "visible" | "hidden", at = 0) {
    return `<p:set>${this.behavior(spid, 1, { attributes: ["style.visibility"], at })}<p:to><p:strVal val="${value}"/></p:to></p:set>`;
  }

  move(
    spid: number,
    duration: number,
    attribute: string,
    from: string,
    to: string,
  ) {
    const tav = (time: number, value: string) =>
      `<p:tav tm="${time}"><p:val><p:strVal val="${value}"/></p:val></p:tav>`;
    return `<p:anim calcmode="lin" valueType="num">${this.behavior(spid, duration, { attributes: [attribute], additive: true })}<p:tavLst>${tav(0, from)}${tav(100000, to)}</p:tavLst></p:anim>`;
  }

  filter(spid: number, duration: number, filter: string, entering: boolean) {
    return `<p:animEffect transition="${entering ? "in" : "out"}" filter="${filter}">${this.behavior(spid, duration)}</p:animEffect>`;
  }

  scale(spid: number, duration: number, by: number, autoReverse = false) {
    const size = Math.round(by * 100000);
    return `<p:animScale>${this.behavior(spid, duration, { autoReverse })}<p:by x="${size}" y="${size}"/></p:animScale>`;
  }
}

/** The behaviours that draw one effect; entrances show the shape first and exits hide it last. */
function behaviors(timeline: Timeline, animation: Animation, spid: number) {
  const { duration } = animation;
  switch (animation.effect) {
    case "spin":
      return `<p:animRot by="${Math.round(animation.degrees * 60000)}">${timeline.behavior(spid, duration, { attributes: ["r"] })}</p:animRot>`;
    case "scale":
      return timeline.scale(spid, duration, animation.scale);
    case "pulse":
      return timeline.scale(
        spid,
        Math.max(1, Math.round(duration / 2)),
        1.05,
        true,
      );
    case "path":
      return `<p:animMotion origin="layout" path="${escapeXml(/\bE\s*$/.test(animation.path) ? animation.path : `${animation.path} E`)}" pathEditMode="relative">${timeline.behavior(spid, duration, { attributes: ["ppt_x", "ppt_y"] })}</p:animMotion>`;
  }
  const entering = animation.kind === "entrance";
  const effect = changeEffect(timeline, animation, spid, entering);
  return entering
    ? `${timeline.visibility(spid, "visible")}${effect}`
    : `${effect}${timeline.visibility(spid, "hidden", duration - 1)}`;
}

type Change = Extract<Animation, { kind: "entrance" | "exit" }>;

function changeEffect(
  timeline: Timeline,
  animation: Change,
  spid: number,
  entering: boolean,
) {
  const { duration } = animation;
  switch (animation.effect) {
    case "fade":
      return timeline.filter(spid, duration, "fade", entering);
    case "wipe":
      return timeline.filter(
        spid,
        duration,
        `wipe(${TOWARD[animation.side]})`,
        entering,
      );
    case "fly": {
      const [attribute, away] = OFF_SLIDE[animation.side];
      const home = `#${attribute}`;
      return timeline.move(
        spid,
        duration,
        attribute,
        entering ? away : home,
        entering ? home : away,
      );
    }
    case "zoom": {
      const grow = (attribute: string) =>
        timeline.move(
          spid,
          duration,
          attribute,
          entering ? "0" : `#${attribute}`,
          entering ? `#${attribute}` : "0",
        );
      return `${grow("ppt_w")}${grow("ppt_h")}${timeline.filter(spid, duration, "fade", entering)}`;
    }
  }
}

const presetClass = (animation: Animation) =>
  "kind" in animation
    ? animation.kind === "entrance"
      ? "entr"
      : "exit"
    : animation.effect === "path"
      ? "path"
      : "emph";

function effectXml(
  timeline: Timeline,
  animation: Animation,
  target: Target,
  nodeType: string,
) {
  const subtype =
    "side" in animation
      ? SUBTYPES[animation.side]
      : animation.effect === "zoom"
        ? ZOOM_FROM_CENTER
        : 0;
  const easing = animation.easing
    ? `${animation.easing.accel > 0 ? ` accel="${Math.round(animation.easing.accel * 100000)}"` : ""}${animation.easing.decel > 0 ? ` decel="${Math.round(animation.easing.decel * 100000)}"` : ""}`
    : "";
  const repeat =
    animation.repeat === undefined
      ? ""
      : ` repeatCount="${animation.repeat === "indefinite" ? "indefinite" : Math.round(animation.repeat * 1000)}"`;
  const id = timeline.id();
  const grpId = timeline.grpId(target);
  return `<p:par><p:cTn id="${id}" presetID="${PRESETS[animation.effect]}" presetClass="${presetClass(animation)}" presetSubtype="${subtype}"${easing}${repeat} fill="hold" grpId="${grpId}" nodeType="${nodeType}"><p:stCondLst><p:cond delay="${animation.delay}"/></p:stCondLst><p:childTnLst>${behaviors(timeline, animation, target.spid)}</p:childTnLst></p:cTn></p:par>`;
}

const playTime = (animation: Animation) =>
  animation.delay +
  animation.duration *
    (typeof animation.repeat === "number" ? animation.repeat : 1);

/** Click groups of steps that play one after another, each step's effects together. */
function clickGroups(animations: readonly Animation[]) {
  const groups: Animation[][][] = [];
  for (const animation of animations) {
    const group = groups.at(-1);
    if (!group || animation.trigger === "onClick") groups.push([[animation]]);
    else if (animation.trigger === "withPrevious")
      group.at(-1)?.push(animation);
    else group.push([animation]);
  }
  return groups;
}

/** The slide's timing tree; the first group starts with the slide when it does not wait for a click. */
export function timingXml(
  animations: readonly Animation[],
  targets: ReadonlyMap<string, Target>,
) {
  if (animations.length === 0) return "";
  const timeline = new Timeline();
  const root = timeline.id();
  const sequence = timeline.id();
  const target = (animation: Animation) => {
    const found = targets.get(animation.target);
    if (!found)
      throw new Error(`animation target ${animation.target} was not drawn`);
    return found;
  };
  const groups = clickGroups(animations).map((steps, index) => {
    const first = steps[0]?.[0];
    const start =
      index === 0 && first?.trigger !== "onClick"
        ? `<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="${sequence}"/></p:cond>`
        : '<p:cond delay="indefinite"/>';
    const groupId = timeline.id();
    let offset = 0;
    const stepsXml = steps
      .map((step) => {
        const stepId = timeline.id();
        const effects = step
          .map((animation) =>
            effectXml(
              timeline,
              animation,
              target(animation),
              NODE_TYPES[animation.trigger],
            ),
          )
          .join("");
        const xml = `<p:par><p:cTn id="${stepId}" fill="hold"><p:stCondLst><p:cond delay="${offset}"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par>`;
        offset += Math.max(...step.map(playTime));
        return xml;
      })
      .join("");
    return `<p:par><p:cTn id="${groupId}" fill="hold"><p:stCondLst>${start}</p:stCondLst><p:childTnLst>${stepsXml}</p:childTnLst></p:cTn></p:par>`;
  });
  const builds = timeline.builds
    .filter(({ target }) => target.build)
    .map(
      ({ target, grpId }) =>
        `<p:bldP spid="${target.spid}" grpId="${grpId}" animBg="1"/>`,
    )
    .join("");
  const slideTarget = (event: string) =>
    `<p:cond evt="${event}" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond>`;
  return `<p:timing><p:tnLst><p:par><p:cTn id="${root}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="${sequence}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${groups.join("")}</p:childTnLst></p:cTn><p:prevCondLst>${slideTarget("onPrev")}</p:prevCondLst><p:nextCondLst>${slideTarget("onNext")}</p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${builds ? `<p:bldLst>${builds}</p:bldLst>` : ""}</p:timing>`;
}
